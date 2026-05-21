import { Peer } from 'https://esm.sh/peerjs@1.4.7';

export class NetworkManager {
    constructor(game) {
        this.game = game;
        this.peer = null;
        this.myId = null;
        this.connections = {}; // Connessioni attive indicizzate per Peer ID: { 'peerId': DataConnection }
        
        this.isHost = false;
        this.hostId = null;
        
        // Verifica se siamo entrati tramite link di invito
        const hash = window.location.hash;
        if (hash && hash.startsWith('#host=')) {
            this.hostId = hash.replace('#host=', '');
            this.isHost = false;
        } else {
            this.isHost = true;
        }
    }

    init(nickname, onReady) {
        this.nickname = nickname;
        
        // Inizializza PeerJS sul server cloud pubblico predefinito
        this.peer = new Peer(undefined, {
            debug: 1 // Solo errori in console per evitare spamming di log
        });

        // Quando la connessione al server di segnalazione è aperta
        this.peer.on('open', (id) => {
            this.myId = id;
            console.log(`[P2P] Il mio Peer ID: ${id}`);
            
            if (this.isHost) {
                this.hostId = id;
                this.updateLobbyUrl();
                onReady(true, id);
            } else {
                console.log(`[P2P] Tentativo di connessione all'host: ${this.hostId}`);
                this.connectToPeer(this.hostId);
                onReady(false, this.hostId);
            }
        });

        // Gestione delle connessioni in entrata (sia per host che per guest)
        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        // Gestione degli errori
        this.peer.on('error', (err) => {
            console.error('[P2P] Errore PeerJS:', err);
            this.game.showToast(`Errore di rete: ${err.type}`, true);
        });

        // Quando il peer viene disconnesso dal server di segnalazione
        this.peer.on('disconnected', () => {
            console.warn('[P2P] Disconnesso dal server di segnalazione. Riconnessione in corso...');
            this.peer.reconnect();
        });
    }

    // Crea una connessione in uscita verso un altro peer
    connectToPeer(targetId) {
        if (this.connections[targetId]) return; // Evita duplicati
        
        console.log(`[P2P] Connessione in uscita verso: ${targetId}`);
        const conn = this.peer.connect(targetId, {
            metadata: { nickname: this.nickname }
        });
        
        this.setupConnection(conn);
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

        conn.on('open', () => {
            console.log(`[P2P] Connesso con successo al peer: ${peerId}`);
            this.connections[peerId] = conn;

            // Se sono l'Host, ho il compito di inoltrare la lista di tutti i partecipanti al nuovo Guest
            if (this.isHost) {
                this.sendPeerListTo(conn);
                this.broadcastSystemMessage(`${conn.metadata.nickname || 'Un nuovo giocatore'} è entrato nella stanza.`);
            }

            // Notifica il gioco per istanziare l'avatar remoto
            this.game.addRemotePlayer(peerId, conn.metadata.nickname || 'Giocatore', { x: 0, y: 0, z: 0 });
            this.game.updateOnlineCount();
        });

        conn.on('data', (data) => {
            this.handleIncomingData(peerId, data);
        });

        conn.on('close', () => {
            console.log(`[P2P] Connessione chiusa con il peer: ${peerId}`);
            this.removePeer(peerId);
        });

        conn.on('error', (err) => {
            console.error(`[P2P] Errore connessione con ${peerId}:`, err);
            this.removePeer(peerId);
        });
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
            const nickname = this.connections[peerId].metadata.nickname || 'Un giocatore';
            delete this.connections[peerId];
            
            if (this.isHost) {
                this.broadcastSystemMessage(`${nickname} è uscito dalla stanza.`);
            }
            
            this.game.removeRemotePlayer(peerId);
            this.game.updateOnlineCount();
        }
    }

    updateLobbyUrl() {
        // Aggiorna l'hash URL con il Peer ID dell'host corrente
        window.location.hash = `host=${this.myId}`;
    }

    getInviteLink() {
        return `${window.location.origin}${window.location.pathname}#host=${this.hostId}`;
    }

    disconnectAll() {
        for (const peerId in this.connections) {
            this.connections[peerId].close();
        }
        if (this.peer) {
            this.peer.destroy();
        }
        this.connections = {};
    }
}
