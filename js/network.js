// Utilizza il costruttore Peer globale caricato via script in index.html
const Peer = window.Peer;

export class NetworkManager {
    constructor(game) {
        this.game = game;
        this.peer = null;
        this.myId = null;
        this.connections = {}; // Connessioni attive indicizzate per Peer ID: { 'peerId': DataConnection }
        
        this.isHost = false;
        this.hostId = null;
        this.isPublicLobby = false;

        // Chiavi TURN attive usate nella sessione corrente
        this.activeTurnApp = null;
        this.activeTurnKey = null;

        // Rileva hash all'avvio
        this.parseHashParams();
    }

    parseHashParams() {
        const hash = window.location.hash;
        if (hash && hash.includes('host=')) {
            const params = {};
            // Rimuove il '#' ed effettua il parsing dei parametri
            hash.substring(1).split('&').forEach(pair => {
                const [key, val] = pair.split('=');
                if (key && val) {
                    params[key] = decodeURIComponent(val);
                }
            });

            if (params.host) {
                this.hostId = params.host;
                this.isHost = false;
            }

            // Se il link di invito contiene le configurazioni TURN dell'host, le importiamo in automatico
            if (params.turnApp && params.turnKey) {
                localStorage.setItem('metered_app_name', params.turnApp);
                localStorage.setItem('metered_api_key', params.turnKey);
            }
        }
    }

    init(nickname, onReady, isPublicLobby = false) {
        this.nickname = nickname;
        this.isPublicLobby = isPublicLobby;
        
        if (this.isPublicLobby) {
            this.hostId = 'hideandseek-lobby-public-room-global';
            this.isHost = false;
        } else {
            // Rileva hash per sicurezza se è cambiato dall'avvio
            this.parseHashParams();
            if (!this.hostId) {
                this.isHost = true;
            }
        }

        this.startPeerConnection(onReady);
    }

    async startPeerConnection(onReady, forceAsHost = false) {
        const peerId = forceAsHost ? 'hideandseek-lobby-public-room-global' : undefined;
        
        if (this.peer) {
            try { this.peer.destroy(); } catch(e) {}
        }

        let iceServers = [
            // Google STUN per connessioni dirette veloci (molteplici server per ridondanza)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // Open Relay TLS TURN su porta standard 443 (UDP e TCP)
            {
                urls: 'turns:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turns:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            // Open Relay TURN non-TLS su porta standard 3478 (UDP)
            {
                urls: 'turn:openrelay.metered.ca:3478',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            // Open Relay TURN non-TLS su porta standard 80 (TCP)
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];

        // Recupera le credenziali Metered.ca da localStorage (se presenti)
        let meteredAppName = localStorage.getItem('metered_app_name');
        let meteredApiKey = localStorage.getItem('metered_api_key');

        // Se non configurate o vuote, usa il fallback predefinito del gioco (hideandseek / PqdU...)
        if (!meteredAppName || !meteredAppName.trim() || !meteredApiKey || !meteredApiKey.trim()) {
            meteredAppName = 'hideandseek';
            meteredApiKey = 'PqdUeZbm3JHFxi63frFMh2maevaX9dXzuaGaKacPDs3TdM6c';
        }

        // Salva le credenziali effettivamente in uso
        this.activeTurnApp = meteredAppName;
        this.activeTurnKey = meteredApiKey;

        if (meteredAppName && meteredApiKey) {
            console.log(`[P2P] Rilevate credenziali Metered.ca. Caricamento server ICE privati...`);
            try {
                let response = await fetch(`https://${meteredAppName}.metered.live/api/v1/turn/credentials?apiKey=${meteredApiKey}`);
                if (!response.ok && response.status === 401) {
                    console.log(`[P2P] GET ha restituito 401. Provo ad utilizzare la chiave come Secret Key via POST...`);
                    const postResponse = await fetch(`https://${meteredAppName}.metered.live/api/v1/turn/credential?secretKey=${meteredApiKey}`, {
                        method: 'POST'
                    });
                    if (postResponse.ok) {
                        const data = await postResponse.json();
                        if (data.apiKey) {
                            console.log(`[P2P] Credenziale temporanea creata con successo. Recupero server ICE...`);
                            response = await fetch(`https://${meteredAppName}.metered.live/api/v1/turn/credentials?apiKey=${data.apiKey}`);
                        }
                    } else {
                        console.warn(`[P2P] Anche il tentativo di POST è fallito con status: ${postResponse.status}`);
                    }
                }

                if (response.ok) {
                    const fetchedIceServers = await response.json();
                    if (Array.isArray(fetchedIceServers) && fetchedIceServers.length > 0) {
                        iceServers = fetchedIceServers;
                        console.log(`[P2P] Server ICE privati caricati correttamente da metered.ca:`, iceServers);
                    }
                } else {
                    console.warn(`[P2P] Risposta non valida dal server Metered: Status ${response.status}. Utilizzo i server pubblici di fallback.`);
                }
            } catch (err) {
                console.error(`[P2P] Errore durante il fetch dei server ICE da Metered.ca. Utilizzo i server pubblici di fallback:`, err);
            }
        }

        this.peer = new Peer(peerId, {
            config: {
                iceServers: iceServers
            },
            debug: 0
        });

        let connectionTimeout = null;
        let hasConnected = false;

        this.peer.on('open', (id) => {
            this.myId = id;
            console.log(`[P2P] Il mio Peer ID: ${id}`);
            
            if (id === 'hideandseek-lobby-public-room-global') {
                this.isHost = true;
                this.hostId = id;
                this.updateLobbyUrl();
                onReady(true, id);
            } else if (this.isHost) {
                this.hostId = id;
                this.updateLobbyUrl();
                onReady(true, id);
            } else {
                console.log(`[P2P] Tentativo di connessione all'host (con ritardo di 1.2s per propagazione): ${this.hostId}`);
                
                if (this.isPublicLobby) {
                    connectionTimeout = setTimeout(() => {
                        if (!hasConnected) {
                            console.log(`[P2P] Connessione al lobby pubblico scaduta. Provo ad autocandidarmi come Host...`);
                            this.peer.destroy();
                            this.startPeerConnection(onReady, true);
                        }
                    }, 5000);
                }

                setTimeout(() => {
                    if (this.peer && !this.peer.destroyed) {
                        this.connectToPeer(this.hostId, (success) => {
                            if (success) {
                                hasConnected = true;
                                if (connectionTimeout) clearTimeout(connectionTimeout);
                            }
                        });
                    }
                }, 1200);
                onReady(false, this.hostId);
            }
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            const isExpectedLobbyError = err.type === 'peer-unavailable' && 
                ((this.isPublicLobby && err.message.includes('hideandseek-lobby-public-room-global')) || 
                 (!this.isHost && this.hostId && err.message.includes(this.hostId)));

            if (isExpectedLobbyError) {
                console.log(`[P2P] Peer non disponibile (previsto per fallback): ${err.message}`);
            } else {
                console.error('[P2P] Errore PeerJS:', err);
            }
            
            if (err.type === 'peer-unavailable') {
                if (this.isPublicLobby && !this.isHost && err.message.includes('hideandseek-lobby-public-room-global')) {
                    if (connectionTimeout) clearTimeout(connectionTimeout);
                    if (!hasConnected) {
                        console.log(`[P2P] Host pubblico non disponibile. Divento io l'Host...`);
                        this.peer.destroy();
                        this.startPeerConnection(onReady, true);
                        return;
                    }
                }
                
                if (!this.isHost && this.hostId && err.message.includes(this.hostId)) {
                    console.log(`[P2P] Host non disponibile (${this.hostId}). Configuro questo client come nuovo Host.`);
                    this.isHost = true;
                    this.hostId = this.myId;
                    this.updateLobbyUrl();
                    this.game.promoteToHost();
                    return;
                }
            }

            if (err.type === 'unavailable-id') {
                if (this.isPublicLobby) {
                    console.log(`[P2P] ID fisso già occupato. Ritorno a provare come Guest...`);
                    this.isHost = false;
                    this.startPeerConnection(onReady, false);
                    return;
                }
            }
            
            this.game.showToast(`Errore di rete: ${err.type}`, true);
        });

        this.peer.on('disconnected', () => {
            console.warn('[P2P] Disconnesso dal server di segnalazione.');
            if (!this.peer.destroyed) {
                this.peer.reconnect();
            }
        });
    }

    // Crea una connessione in uscita verso un altro peer
    connectToPeer(targetId, callback = null) {
        if (this.connections[targetId]) {
            if (callback) callback(true);
            return;
        }
        
        console.log(`[P2P] Connessione in uscita verso: ${targetId}`);
        const conn = this.peer.connect(targetId, {
            metadata: { nickname: this.nickname }
        });
        
        this.setupConnection(conn);

        if (callback) {
            conn.on('open', () => callback(true));
            conn.on('error', () => callback(false));
        }
    }

    // Configura i listener di eventi su una connessione (in ingresso o in uscita)
    setupConnection(conn) {
        const peerId = conn.peer;

        // Regola lessicografica per prevenire connessioni parallele ridondanti:
        // Se c'è già una connessione in corso o stiamo entrambi provando a connetterci,
        // lasciamo che il peer con ID lessicograficamente minore gestisca il canale.
        if (this.connections[peerId]) {
            if (this.myId > peerId) {
                // Chiudi questa connessione ridondante in favore di quella esistente
                console.log(`[P2P] Chiudo connessione duplicata in favore del peer minore: ${peerId}`);
                conn.close();
                return;
            }
        }

        // Avvia tracciamento diagnostico dello stato ICE per monitorare la connessione WebRTC
        if (conn.peerConnection) {
            this.setupIceStateTracking(conn);
        } else {
            let checkCount = 0;
            const checkInterval = setInterval(() => {
                checkCount++;
                if (conn.peerConnection) {
                    clearInterval(checkInterval);
                    this.setupIceStateTracking(conn);
                } else if (checkCount > 50) {
                    clearInterval(checkInterval);
                }
            }, 100);
        }

        conn.on('open', () => {
            console.log(`[P2P] Connesso con successo al peer: ${peerId}`);
            this.connections[peerId] = conn;

            // Se sono l'Host, ho il compito di inoltrare la lista di tutti i partecipanti al nuovo Guest
            if (this.isHost) {
                this.sendPeerListTo(conn);
                this.broadcastSystemMessage(`${conn.metadata?.nickname || 'Un nuovo giocatore'} è entrato nella stanza.`);
            } else {
                // Se sono un Guest e mi sono connesso all'Host, aggiorna lo stato HUD
                if (peerId === this.hostId) {
                    this.game.showToast('Connessione stabilita con l\'Host!', false);
                    const lobbyStatus = document.getElementById('lobby-status-text');
                    if (lobbyStatus) lobbyStatus.textContent = 'Connesso a Stanza Remota';
                }
            }

            // Notifica il gioco per istanziare l'avatar remoto
            this.game.addRemotePlayer(peerId, conn.metadata?.nickname || 'Giocatore', { x: 0, y: 0, z: 0 });
            this.game.updateOnlineCount();
        });

        conn.on('data', (data) => {
            this.handleIncomingData(peerId, data);
        });

        conn.on('close', () => {
            console.log(`[P2P] Connessione chiusa con il peer: ${peerId}`);
            this.removePeer(peerId);

            // Riconnessione automatica nel lobby pubblico se l'Host si disconnette
            if (this.isPublicLobby && !this.isHost && peerId === this.hostId) {
                console.log("[P2P] Host pubblico chiuso. Avvio riconnessione...");
                this.game.showToast("L'Host si è disconnesso. Riconnessione al Mondo Pubblico...", false);
                this.game.reconnectToPublicLobby();
            }
        });

        conn.on('error', (err) => {
            console.error(`[P2P] Errore connessione con ${peerId}:`, err);
            this.removePeer(peerId);
        });
    }

    // Traccia lo stato della connessione ICE per diagnosticare problemi di rete (NAT/Firewall)
    setupIceStateTracking(conn) {
        const pc = conn.peerConnection;
        const peerId = conn.peer;
        const nickname = conn.metadata?.nickname || 'Giocatore';

        console.log(`[P2P] Avviato monitoraggio ICE per peer: ${peerId}`);

        const onStateChange = () => {
            const state = pc.iceConnectionState;
            console.log(`[P2P] Stato ICE per ${nickname} (${peerId}): ${state}`);
            
            if (state === 'failed') {
                console.error(`[P2P] La connessione ICE tra client è fallita.`);
                this.game.showToast(`Connessione P2P fallita con ${nickname}. Possibile blocco NAT/Firewall.`, true);
            }
        };

        pc.addEventListener('iceconnectionstatechange', onStateChange);
        
        pc.addEventListener('icecandidateerror', (event) => {
            console.warn(`[P2P] Errore candidato ICE per ${nickname}: Codice=${event.errorCode}, Testo=${event.errorText || 'Nessuno'}, Server=${event.url || 'Sconosciuto'}`);
        });

        pc.addEventListener('icegatheringstatechange', () => {
            console.log(`[P2P] Stato raccolta candidati ICE per ${nickname}: ${pc.iceGatheringState}`);
        });

        pc.addEventListener('icecandidate', (event) => {
            if (event.candidate) {
                const c = event.candidate;
                console.log(`[P2P] Candidato ICE trovato per ${nickname}: Tipo=${c.type || 'Sconosciuto'}, Protocollo=${c.protocol || 'Sconosciuto'}, Indirizzo=${c.address || 'N/A'}`);
            } else {
                console.log(`[P2P] Raccolta candidati ICE completata per ${nickname}.`);
            }
        });

        onStateChange();
    }

    // L'Host inoltra la lista dei peer connessi al nuovo utente, permettendo la mesh automatica
    sendPeerListTo(conn) {
        // Raccoglie tutti i peer attivi nella mesh (inclusi l'host stesso)
        const peerIds = Object.keys(this.connections).filter(id => id !== conn.peer);
        peerIds.push(this.myId); // Aggiungi me stesso (l'Host) alla lista

        conn.send({
            type: 'peer-list',
            peers: peerIds
        });
    }

    // Gestione pacchetti dati in entrata
    handleIncomingData(senderId, data) {
        switch (data.type) {
            case 'peer-list':
                // Ricevuto solo dai Guest all'avvio. Connettiti a tutti gli altri membri della stanza.
                console.log('[P2P] Ricevuta lista dei peer dall\'host:', data.peers);
                data.peers.forEach(peerId => {
                    if (peerId !== this.myId) {
                        this.connectToPeer(peerId);
                    }
                });
                break;

            case 'state':
                // Sincronizzazione posizione e rotazione degli altri giocatori
                this.game.updateRemotePlayer(senderId, data.position, data.rotationY);
                break;

            case 'chat':
                // Ricevuto messaggio chat. Calcola la prossimità prima di visualizzarlo.
                this.game.receiveChatMessage(data.nickname, data.message, data.position);
                break;

            case 'system-msg':
                // Messaggio di sistema inviato dall'host
                this.game.addSystemMessage(data.message);
                break;
        }
    }

    // Invia lo stato del giocatore locale (posizione e rotazione) a tutti i peer della mesh
    broadcastState(position, rotationY) {
        const payload = {
            type: 'state',
            position: { x: position.x, y: position.y, z: position.z },
            rotationY: rotationY
        };
        this.broadcast(payload);
    }

    // Invia un messaggio di chat a tutti i peer
    broadcastChatMessage(nickname, message, position) {
        const payload = {
            type: 'chat',
            nickname: nickname,
            message: message,
            position: { x: position.x, y: position.y, z: position.z }
        };
        this.broadcast(payload);
    }

    // Invia un messaggio di sistema a tutti i peer (solo se Host)
    broadcastSystemMessage(message) {
        if (!this.isHost) return;
        const payload = {
            type: 'system-msg',
            message: message
        };
        this.broadcast(payload);
        // Mostra anche localmente
        this.game.addSystemMessage(message);
    }

    // Helper per inviare dati a TUTTI i peer connessi
    broadcast(data) {
        for (const peerId in this.connections) {
            const conn = this.connections[peerId];
            if (conn.open) {
                conn.send(data);
            }
        }
    }

    removePeer(peerId) {
        if (this.connections[peerId]) {
            const nickname = this.connections[peerId].metadata?.nickname || 'Un giocatore';
            delete this.connections[peerId];
            
            if (this.isHost) {
                this.broadcastSystemMessage(`${nickname} è uscito dalla stanza.`);
            }
            
            this.game.removeRemotePlayer(peerId);
            this.game.updateOnlineCount();
        }
    }

    updateLobbyUrl() {
        // Aggiorna l'hash URL con il Peer ID dell'host corrente e include i dettagli TURN se presenti
        let hash = `host=${this.myId}`;
        if (this.activeTurnApp && this.activeTurnKey) {
            hash += `&turnApp=${encodeURIComponent(this.activeTurnApp)}&turnKey=${encodeURIComponent(this.activeTurnKey)}`;
        }
        window.location.hash = hash;
    }

    getInviteLink() {
        let link = `${window.location.origin}${window.location.pathname}#host=${this.hostId}`;
        if (this.activeTurnApp && this.activeTurnKey) {
            link += `&turnApp=${encodeURIComponent(this.activeTurnApp)}&turnKey=${encodeURIComponent(this.activeTurnKey)}`;
        }
        return link;
    }

    disconnectAll() {
        for (const peerId in this.connections) {
            this.connections[peerId].close();
        }
        if (this.peer) {
            this.peer.destroy();
        }
        this.connections = {};
        this.isHost = false;
        this.hostId = null;
        this.activeTurnApp = null;
        this.activeTurnKey = null;
    }
}
