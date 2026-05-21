import * as THREE from 'three';
import { Engine } from './engine.js';
import { InputHandler } from './input.js';
import { LocalPlayer, RemotePlayer } from './player.js';
import { NetworkManager } from './network.js';
import { LobbyDiscovery } from './lobby.js';

class Game {
    constructor() {
        this.engine = null;
        this.input = null;
        this.localPlayer = null;
        this.remotePlayers = {}; // Mappa dei player remoti indicizzati per Peer ID: { 'peerId': RemotePlayer }
        
        this.network = new NetworkManager(this);
        this.lobby = new LobbyDiscovery();
        this.clock = new THREE.Clock();
        
        // Throttling di rete (20 FPS = 50ms)
        this.syncInterval = 0.05;
        this.syncTimer = 0;

        // UI Refs
        this.mainMenu = document.getElementById('main-menu');
        this.nicknameInput = document.getElementById('nickname-input');
        this.startBtn = document.getElementById('start-btn');
        this.gameHud = document.getElementById('game-hud');
        
        // Lobby UI Refs
        this.isPublicLobby = false;
        this.joinPublicBtn = document.getElementById('join-public-btn');
        this.openWorldsBtn = document.getElementById('open-worlds-btn');
        this.lobbyModal = document.getElementById('lobby-modal');
        this.closeLobbyBtn = document.getElementById('close-lobby-btn');
        this.roomsListContainer = document.getElementById('rooms-list-container');
        this.stopFindingRooms = null;

        // Exit UI Refs
        this.confirmExitModal = document.getElementById('confirm-exit-modal');
        this.exitConfirmYes = document.getElementById('exit-confirm-yes');
        this.exitConfirmNo = document.getElementById('exit-confirm-no');
        this.menuExitBtn = document.getElementById('menu-exit-btn');
        this.hudExitBtn = document.getElementById('hud-exit-btn');
        this.isAppExit = false;
        this.isLoopRunning = false;
        
        this.initUI();
    }

    initUI() {
        // Rileva se stiamo entrando come Guest per informare l'utente
        if (this.network.hostId && !this.network.isHost) {
            const roomInfo = document.getElementById('room-info-section');
            const hostDisplay = document.getElementById('target-host-display');
            if (roomInfo && hostDisplay) {
                roomInfo.classList.remove('hidden');
                hostDisplay.textContent = this.network.hostId.substring(0, 8) + '...';
            }

            // Nascondi pulsanti inutili se siamo entrati via invito diretto
            if (this.joinPublicBtn) this.joinPublicBtn.classList.add('hidden');
            if (this.openWorldsBtn) this.openWorldsBtn.classList.add('hidden');
        }

        // Avvio del gioco al click su INIZIA (Stanza Privata)
        this.startBtn.addEventListener('click', () => {
            this.isPublicLobby = false;
            this.startGame();
        });

        // Entra nel mondo pubblico
        if (this.joinPublicBtn) {
            this.joinPublicBtn.addEventListener('click', () => {
                this.isPublicLobby = true;
                this.startGame();
            });
        }

        // Gestione Modal Mondi Aperti
        this.openWorldsBtn.addEventListener('click', () => this.openLobbyModal());
        this.closeLobbyBtn.addEventListener('click', () => this.closeLobbyModal());

        // Supporto per invio premendo Invio nel campo Nickname
        this.nicknameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.startGame();
            }
        });

        // Configurazione Chat Overlay
        const chatInput = document.getElementById('chat-input');
        const chatSendBtn = document.getElementById('chat-send-btn');

        chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        
        // Gestore del tasto Enter globale per aprire/inviare la chat (UX da gioco PC)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Se il menu principale è ancora attivo, non fare nulla per la chat
                if (!this.mainMenu.classList.contains('hidden')) return;

                if (document.activeElement === chatInput) {
                    this.sendChatMessage();
                    chatInput.blur();
                } else {
                    chatInput.focus();
                    e.preventDefault(); // Previene l'inserimento accidentale di a capo o simili
                }
            }
        });

        // Gestore del tasto Escape per aprire il menu di conferma uscita
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Mostra il menu di conferma solo se siamo in gioco (menu principale nascosto)
                // e se il modal non è già aperto
                if (this.mainMenu.classList.contains('hidden') && this.confirmExitModal.classList.contains('hidden')) {
                    this.showConfirmExitModal(false);
                }
            }
        });

        // Cliccando sul tasto esci della home (menu principale)
        if (this.menuExitBtn) {
            this.menuExitBtn.addEventListener('click', () => {
                this.showConfirmExitModal(true);
            });
        }

        // Cliccando sul tasto esci dell'HUD (in gioco)
        if (this.hudExitBtn) {
            this.hudExitBtn.addEventListener('click', () => {
                this.showConfirmExitModal(false);
            });
        }

        // Configurazione pulsanti di conferma uscita
        this.exitConfirmYes.addEventListener('click', () => {
            if (this.isAppExit) {
                this.exitApplication();
            } else {
                this.exitGame();
            }
        });
        this.exitConfirmNo.addEventListener('click', () => this.hideConfirmExitModal());
    }

    startGame() {
        let nickname = this.nicknameInput.value.trim();
        
        // Assegna nickname casuale se vuoto
        if (!nickname) {
            nickname = 'User_' + Math.floor(1000 + Math.random() * 9000);
        }

        // Nascondi Menu
        this.mainMenu.classList.add('hidden');
        
        // Mostra HUD
        this.gameHud.classList.remove('hidden');
        document.getElementById('hud-nickname').textContent = nickname;

        // Inizializza Motore 3D, Input e Player locale
        this.engine = new Engine('canvas-container');
        this.input = new InputHandler();
        this.localPlayer = new LocalPlayer(nickname, this.engine.scene);

        this.showToast('Inizializzazione connessione di rete...');

        // Inizializza rete
        this.network.init(nickname, (isHost, roomOwnerId) => {
            const lobbyStatus = document.getElementById('lobby-status-text');
            const shareBtn = document.getElementById('share-lobby-btn');

            if (isHost) {
                lobbyStatus.textContent = 'Host (Lobby Aperta)';
                this.showToast('Stanza creata! Generazione link invito...', false);
                
                // Mostra e configura il tasto di condivisione
                shareBtn.classList.remove('hidden');
                shareBtn.addEventListener('click', () => this.copyShareLink());

                // Annuncia stanza su MQTT per la lista dei Mondi Aperti
                this.lobby.startAnnouncing(roomOwnerId, nickname);
            } else {
                lobbyStatus.textContent = 'Connessione all\'Host...';
                this.showToast('Ricerca e connessione all\'Host in corso...', false);
            }
            
            this.updateOnlineCount();
            
            // Avvia Loop di Gioco principale (solo se non già in esecuzione)
            if (!this.isLoopRunning) {
                this.isLoopRunning = true;
                this.animate();
            }
        }, this.isPublicLobby);
    }

    openLobbyModal() {
        this.lobbyModal.classList.remove('hidden');
        this.roomsListContainer.innerHTML = '<div class="no-rooms-message">Ricerca stanze in corso...</div>';
        
        // Connetti e ascolta le stanze attive via MQTT
        this.stopFindingRooms = this.lobby.findRooms((activeRooms) => {
            this.updateRoomsListUI(activeRooms);
        });
    }

    closeLobbyModal() {
        this.lobbyModal.classList.add('hidden');
        if (this.stopFindingRooms) {
            this.stopFindingRooms();
            this.stopFindingRooms = null;
        }
    }

    updateRoomsListUI(activeRooms) {
        if (!activeRooms || activeRooms.length === 0) {
            this.roomsListContainer.innerHTML = '<div class="no-rooms-message">Nessuna stanza attiva trovata al momento.</div>';
            return;
        }

        this.roomsListContainer.innerHTML = '';
        activeRooms.forEach(room => {
            const roomEl = document.createElement('div');
            roomEl.className = 'room-item';
            
            const roomInfo = document.createElement('div');
            roomInfo.className = 'room-info';
            
            const roomHost = document.createElement('span');
            roomHost.className = 'room-host';
            roomHost.textContent = `Stanza di ${room.hostName}`;
            
            const roomId = document.createElement('span');
            roomId.className = 'room-id';
            roomId.textContent = `ID: ${room.peerId.substring(0, 12)}...`;
            
            roomInfo.appendChild(roomHost);
            roomInfo.appendChild(roomId);
            
            const joinBtn = document.createElement('button');
            joinBtn.className = 'room-join-btn';
            joinBtn.textContent = 'UNISCITI';
            
            joinBtn.addEventListener('click', () => {
                // Imposta il host target
                this.network.hostId = room.peerId;
                this.network.isHost = false;
                window.location.hash = `#host=${room.peerId}`;
                
                // Mostra a schermo l'info della stanza target nel menu di avvio
                const roomInfoSec = document.getElementById('room-info-section');
                const hostDisplay = document.getElementById('target-host-display');
                if (roomInfoSec && hostDisplay) {
                    roomInfoSec.classList.remove('hidden');
                    hostDisplay.textContent = room.hostName;
                }
                
                // Chiudi il modal ed avvia il gioco
                this.closeLobbyModal();
                this.startGame();
            });
            
            roomEl.appendChild(roomInfo);
            roomEl.appendChild(joinBtn);
            
            this.roomsListContainer.appendChild(roomEl);
        });
    }

    reconnectToPublicLobby() {
        // Rimuovi tutti i giocatori remoti correnti
        for (const peerId in this.remotePlayers) {
            this.removeRemotePlayer(peerId);
        }
        
        // Scollega e distruggi il vecchio peer
        this.network.disconnectAll();
        
        const lobbyStatus = document.getElementById('lobby-status-text');
        if (lobbyStatus) lobbyStatus.textContent = 'Riconnessione...';
        
        this.showToast('Tentativo di riconnessione al lobby pubblico...', false);
        
        // Re-inizializza come lobby pubblico
        this.network.init(this.localPlayer.nickname, (isHost, roomOwnerId) => {
            const lobbyStatus = document.getElementById('lobby-status-text');
            const shareBtn = document.getElementById('share-lobby-btn');

            if (isHost) {
                if (lobbyStatus) lobbyStatus.textContent = 'Host (Lobby Pubblica)';
                if (shareBtn) shareBtn.classList.remove('hidden');
                this.lobby.startAnnouncing(roomOwnerId, this.localPlayer.nickname);
            } else {
                if (lobbyStatus) lobbyStatus.textContent = 'Connesso a Stanza Pubblica';
                if (shareBtn) shareBtn.classList.add('hidden');
            }
            this.updateOnlineCount();
        }, true);
    }

    showConfirmExitModal(isAppExit = false) {
        this.isAppExit = isAppExit;
        
        const titleEl = this.confirmExitModal.querySelector('.modal-title');
        const subtitleEl = this.confirmExitModal.querySelector('.modal-subtitle');
        
        if (isAppExit) {
            titleEl.textContent = "Vuoi uscire?";
            subtitleEl.textContent = "Vuoi uscire definitivamente dall'applicazione?";
        } else {
            titleEl.textContent = "Sei sicuro?";
            subtitleEl.textContent = "Vuoi davvero uscire dalla stanza di gioco e tornare al menu principale?";
        }

        this.confirmExitModal.classList.remove('hidden');
        if (document.pointerLockElement === document.body) {
            document.exitPointerLock();
        }
    }

    exitApplication() {
        this.confirmExitModal.classList.add('hidden');
        
        // Prova a chiudere la scheda
        window.close();
        
        // Fallback schermata di saluto interattiva/professionale per fiera
        document.body.innerHTML = `
            <div style="
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                justify-content: center; 
                height: 100vh; 
                background: radial-gradient(circle at center, #1e1b4b 0%, #0f0728 100%); 
                color: #ffffff; 
                font-family: 'Outfit', sans-serif;
                text-align: center;
                padding: 20px;
                box-sizing: border-box;
            ">
                <h1 style="
                    font-size: 3.5rem; 
                    font-weight: 800; 
                    background: linear-gradient(135deg, #ff007f 0%, #7928ca 100%); 
                    -webkit-background-clip: text; 
                    -webkit-text-fill-color: transparent;
                    margin: 0 0 16px 0;
                    letter-spacing: -1px;
                ">HIDE & SEEK</h1>
                <p style="font-size: 1.3rem; color: #a5b4fc; font-weight: 500; margin: 0 0 30px 0;">
                    Grazie per aver giocato! La sessione è terminata con successo.
                </p>
                <div style="
                    background: rgba(255, 255, 255, 0.03); 
                    border: 1px solid rgba(255, 255, 255, 0.08); 
                    padding: 18px 36px; 
                    border-radius: 16px;
                    font-size: 0.95rem;
                    color: #818cf8;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                ">
                    Puoi chiudere questa scheda del browser o ricaricare la pagina per ricominciare.
                </div>
            </div>
        `;
    }

    hideConfirmExitModal() {
        this.confirmExitModal.classList.add('hidden');
        // Richiedi il pointer lock dopo una breve attesa dato che l'utente ha fatto click
        setTimeout(() => {
            if (document.pointerLockElement !== document.body && this.mainMenu.classList.contains('hidden')) {
                try {
                    const promise = document.body.requestPointerLock();
                    if (promise && typeof promise.catch === 'function') {
                        promise.catch(err => {
                            console.warn("[Input] Pointer lock temporaneamente rifiutato dal browser:", err.message);
                        });
                    }
                } catch (err) {
                    console.warn("[Input] Errore Pointer lock:", err);
                }
            }
        }, 100);
    }

    exitGame() {
        this.confirmExitModal.classList.add('hidden');
        this.isLoopRunning = false;
        
        // Scollega rete e distruggi peer
        if (this.network) {
            this.network.disconnectAll();
        }
        if (this.lobby) {
            this.lobby.stopAnnouncing();
        }
        
        // Rimuovi giocatori remoti
        for (const peerId in this.remotePlayers) {
            this.removeRemotePlayer(peerId);
        }
        this.remotePlayers = {};

        // Rimuovi hash URL
        window.location.hash = '';

        // Distruggi Three.js engine
        if (this.engine) {
            const container = document.getElementById('canvas-container');
            if (container) container.innerHTML = '';
            this.engine = null;
        }

        this.input = null;
        this.localPlayer = null;

        // Ripristina UI
        this.gameHud.classList.add('hidden');
        this.mainMenu.classList.remove('hidden');

        // Ripristina visualizzazione pulsanti
        const joinPublicBtn = document.getElementById('join-public-btn');
        const openWorldsBtn = document.getElementById('open-worlds-btn');
        if (joinPublicBtn) joinPublicBtn.classList.remove('hidden');
        if (openWorldsBtn) openWorldsBtn.classList.remove('hidden');

        const roomInfoSec = document.getElementById('room-info-section');
        if (roomInfoSec) roomInfoSec.classList.add('hidden');

        this.showToast('Sei tornato al menu principale.', false);
    }

    copyShareLink() {
        const link = this.network.getInviteLink();
        navigator.clipboard.writeText(link).then(() => {
            this.showToast('Link stanza copiato nei appunti! Invalo a un amico.', false);
        }).catch(err => {
            console.error('Impossibile copiare il link:', err);
            this.showToast('Impossibile copiare il link automaticamente. Copialo dalla barra degli indirizzi.', true);
        });
    }

    promoteToHost() {
        const lobbyStatus = document.getElementById('lobby-status-text');
        const shareBtn = document.getElementById('share-lobby-btn');

        if (lobbyStatus) lobbyStatus.textContent = 'Host (Stanza Ripristinata)';
        if (shareBtn) {
            shareBtn.classList.remove('hidden');
            // Sostituisce il bottone con un suo clone per ripulire eventuali event listener precedenti
            const newShareBtn = shareBtn.cloneNode(true);
            shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
            newShareBtn.addEventListener('click', () => this.copyShareLink());
        }

        // Annuncia la nostra stanza su MQTT dato che siamo diventati Host
        if (this.lobby) {
            this.lobby.startAnnouncing(this.network.myId, this.localPlayer.nickname);
        }

        this.showToast('L\'Host precedente non è raggiungibile. Ora sei tu l\'Host di questa stanza!', false);
    }

    // Aggiunge un player remoto alla scena 3D
    addRemotePlayer(peerId, name, startPos) {
        if (this.remotePlayers[peerId]) return;
        
        this.remotePlayers[peerId] = new RemotePlayer(name, this.engine.scene, startPos);
        this.showToast(`${name} si è connesso.`, false);
    }

    // Aggiorna lo stato di posizione/rotazione interpolato
    updateRemotePlayer(peerId, position, rotationY) {
        const player = this.remotePlayers[peerId];
        if (player) {
            player.setTransform(position, rotationY);
        }
    }

    // Rimuove un player remoto dalla scena
    removeRemotePlayer(peerId) {
        const player = this.remotePlayers[peerId];
        if (player) {
            this.showToast(`${player.nickname} si è disconnesso.`, true);
            player.destroy();
            delete this.remotePlayers[peerId];
        }
    }

    updateOnlineCount() {
        // Conta me stesso + tutti i peer remoti connessi
        const count = 1 + Object.keys(this.network.connections).length;
        document.getElementById('online-count').textContent = count;
    }

    // Invio chat locale e broadcast di rete
    sendChatMessage() {
        const chatInput = document.getElementById('chat-input');
        const text = chatInput.value.trim();
        if (!text) return;

        // Invia ai peer
        this.network.broadcastChatMessage(this.localPlayer.nickname, text, this.localPlayer.position);
        
        // Mostra localmente saltando il filtro di prossimità
        this.receiveChatMessage(this.localPlayer.nickname, text, this.localPlayer.position, true);
        
        chatInput.value = '';
    }

    // Ricezione chat di prossimità con logica di calcolo distanza
    receiveChatMessage(senderName, message, senderPos, isLocal = false) {
        const messagesContainer = document.getElementById('chat-messages');
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';

        if (isLocal) {
            msgEl.classList.add('msg-local');
            msgEl.innerHTML = `<span class="msg-sender">${senderName} (Tu):</span> <span class="msg-text">${message}</span>`;
        } else {
            // Calcolo distanza euclidea 3D tra il giocatore locale e il mittente
            const distance = this.localPlayer.position.distanceTo(new THREE.Vector3(senderPos.x, senderPos.y, senderPos.z));
            const maxProximityRange = 20.0;
            const whisperRange = 40.0;

            if (distance <= maxProximityRange) {
                // Raggio normale: chat leggibile
                msgEl.innerHTML = `<span class="msg-sender">${senderName}:</span> <span class="msg-text">${message}</span>`;
            } else if (distance <= whisperRange) {
                // Raggio sussurro: messaggio modificato e attenuato
                msgEl.classList.add('msg-whisper');
                msgEl.innerHTML = `<span class="msg-sender">[Sussurro] Qualcuno da lontano...</span> <span class="msg-text">"...${message.substring(0, Math.ceil(message.length * 0.3))}..."</span>`;
            } else {
                // Fuori portata di prossimità: il messaggio non viene mostrato
                return;
            }
        }

        messagesContainer.appendChild(msgEl);
        
        // Autoscroll verso il basso
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Aggiunge messaggi di sistema generali (es. connessione/disconnessione)
    addSystemMessage(message) {
        const messagesContainer = document.getElementById('chat-messages');
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg msg-system';
        msgEl.textContent = `[Info] ${message}`;
        messagesContainer.appendChild(msgEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Render loop del gioco
    animate() {
        if (!this.isLoopRunning) return;
        requestAnimationFrame(() => this.animate());

        const dt = this.clock.getDelta();
        
        // 1. Aggiorna giocatore locale, camera e collisioni
        if (this.localPlayer && this.input && this.engine) {
            this.localPlayer.update(dt, this.input, this.engine.obstacles, this.engine.camera);
        }

        // 2. Aggiorna tutti i giocatori remoti (Interpolazione fluida)
        for (const peerId in this.remotePlayers) {
            this.remotePlayers[peerId].update(dt);
        }

        // 3. Sincronizzazione di rete a frequenza controllata (Throttling a 20Hz)
        this.syncTimer += dt;
        if (this.syncTimer >= this.syncInterval) {
            if (this.localPlayer && this.network) {
                this.network.broadcastState(this.localPlayer.position, this.localPlayer.rotationY);
            }
            this.syncTimer = 0;
        }

        // 4. Renderizzazione scena 3D
        if (this.engine) {
            this.engine.render();
        }
    }

    // Gestione Notifiche Toast in overlay
    showToast(message, isError = false) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        if (isError) toast.classList.add('toast-error');
        else toast.classList.add('toast-success');
        
        toast.textContent = message;
        container.appendChild(toast);

        // Rimuovi dopo 4 secondi con transizione liscia
        setTimeout(() => {
            toast.style.transition = 'opacity 0.5s, transform 0.5s';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => {
                if (toast.parentNode === container) {
                    container.removeChild(toast);
                }
            }, 500);
        }, 3500);
    }
}

// Avvia l'applicazione all'avvio della pagina
window.addEventListener('DOMContentLoaded', () => {
    window.gameInstance = new Game();
});
