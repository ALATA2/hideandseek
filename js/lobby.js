// Gestione della pubblicazione e ricerca delle stanze tramite un Broker MQTT pubblico (Serverless)
export class LobbyDiscovery {
    constructor() {
        this.client = null;
        this.baseTopic = 'hideandseek/lobby';
        this.rooms = {}; // Aggrega le stanze trovate: { peerId: { hostName, timestamp } }
        this.isAnnouncing = false;
        this.announcerInterval = null;
        this.brokerUrl = 'wss://broker.hivemq.com:8884/mqtt'; // Porta WebSocket sicura SSL
    }

    // --- FUNZIONE PER L'HOST: Annuncia la propria presenza ---
    startAnnouncing(peerId, hostName) {
        if (this.isAnnouncing) return;
        this.isAnnouncing = true;

        console.log('[Lobby] Avvio annuncio stanza su MQTT...');
        
        // Connettiti al broker MQTT
        this.client = window.mqtt.connect(this.brokerUrl);

        this.client.on('connect', () => {
            console.log('[Lobby] Connesso al broker MQTT (Host).');
            
            // Sottoscrivi al canale dei ping per rispondere immediatamente quando un guest cerca stanze
            this.client.subscribe(`${this.baseTopic}/ping`, (err) => {
                if (!err) {
                    this.sendAnnouncement(peerId, hostName);
                }
            });
        });

        this.client.on('message', (topic, message) => {
            if (topic === `${this.baseTopic}/ping`) {
                // Se qualcuno fa il "ping", rimanda subito le informazioni della stanza
                this.sendAnnouncement(peerId, hostName);
            }
        });

        // Invia l'annuncio iniziale e imposta un battito cardiaco ogni 12 secondi
        this.announcerInterval = setInterval(() => {
            this.sendAnnouncement(peerId, hostName);
        }, 12000);
    }

    sendAnnouncement(peerId, hostName) {
        if (!this.client || !this.client.connected) return;

        const meteredAppName = localStorage.getItem('metered_app_name');
        const meteredApiKey = localStorage.getItem('metered_api_key');

        const payload = JSON.stringify({
            peerId: peerId,
            hostName: hostName,
            timestamp: Date.now(),
            turnApp: meteredAppName || undefined,
            turnKey: meteredApiKey || undefined
        });

        // Pubblica sul canale specifico di questa stanza con retain: true
        // (il broker salverà l'ultimo stato inviando l'info all'istante a chi si iscrive)
        this.client.publish(`${this.baseTopic}/rooms/${peerId}`, payload, { retain: true });
    }

    stopAnnouncing() {
        this.isAnnouncing = false;
        if (this.announcerInterval) {
            clearInterval(this.announcerInterval);
            this.announcerInterval = null;
        }
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }

    // --- FUNZIONE PER IL GUEST: Trova le stanze attive ---
    findRooms(onRoomListUpdated) {
        this.rooms = {};
        console.log('[Lobby] Ricerca stanze attive...');

        const client = window.mqtt.connect(this.brokerUrl);
        
        client.on('connect', () => {
            console.log('[Lobby] Connesso al broker MQTT (Guest). Sottoscrizione...');
            
            // Sottoscrivi a tutti gli annunci delle stanze
            client.subscribe(`${this.baseTopic}/rooms/+`, (err) => {
                if (!err) {
                    // Invia un ping per costringere i server attivi a rispondere subito
                    client.publish(`${this.baseTopic}/ping`, 'ping');
                }
            });
        });

        client.on('message', (topic, message) => {
            try {
                const data = JSON.parse(message.toString());
                
                // Ignora stanze con dati corrotti o incomplete
                if (!data.peerId || !data.hostName) return;

                // Salva o aggiorna i dati della stanza
                this.rooms[data.peerId] = {
                    peerId: data.peerId,
                    hostName: data.hostName,
                    timestamp: data.timestamp,
                    turnApp: data.turnApp,
                    turnKey: data.turnKey
                };

                // Filtra stanze scadute (nessun segnale da più di 40 secondi)
                const activeRooms = this.getActiveRoomsList();
                onRoomListUpdated(activeRooms);
            } catch (e) {
                console.error('[Lobby] Errore parsing messaggio MQTT:', e);
            }
        });

        // Ritorna una funzione di chiusura per disconnettersi quando l'utente chiude il pannello
        return () => {
            console.log('[Lobby] Interruzione ricerca stanze e disconnessione.');
            client.end();
        };
    }

    getActiveRoomsList() {
        const now = Date.now();
        const timeout = 40000; // 40 secondi
        return Object.values(this.rooms).filter(room => (now - room.timestamp) < timeout);
    }
}
