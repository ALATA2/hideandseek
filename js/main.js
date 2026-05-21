import * as THREE from 'three';
import { Engine } from './engine.js';
import { InputHandler } from './input.js';
import { LocalPlayer, RemotePlayer } from './player.js';
import { NetworkManager } from './network.js';

class Game {
    constructor() {
        this.engine = null;
        this.input = null;
        this.localPlayer = null;
        this.remotePlayers = {}; // Mappa dei player remoti indicizzati per Peer ID: { 'peerId': RemotePlayer }
        
        this.network = new NetworkManager(this);
        this.clock = new THREE.Clock();
        
        // Throttling di rete (20 FPS = 50ms)
        this.syncInterval = 0.05;
        this.syncTimer = 0;

        // UI Refs
        this.mainMenu = document.getElementById('main-menu');
        this.nicknameInput = document.getElementById('nickname-input');
        this.startBtn = document.getElementById('start-btn');
        this.gameHud = document.getElementById('game-hud');
        
        this.initUI();
    }

    initUI() {
        // Rileva se stiamo entrando come Guest per informare l'utente
        if (this.network.hostId && !this.network.isHost) {
            const roomInfo = document.getElementById('room-info-section');
            const hostDisplay = document.getElementById('target-host-display');
            roomInfo.classList.remove('hidden');
            hostDisplay.textContent = this.network.hostId.substring(0, 8) + '...';
        }

        // Avvio del gioco al click su INIZIA
        this.startBtn.addEventListener('click', () => this.startGame());

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
            } else {
                lobbyStatus.textContent = 'Connesso a Stanza Remota';
                this.showToast('Connessione stabilita con l\'host!', false);
            }
            
            this.updateOnlineCount();
            
            // Avvia Loop di Gioco principale
            this.animate();
        });
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
