export class InputHandler {
    constructor() {
        this.moveVector = { x: 0, z: 0 };
        this.yaw = 0; // Rotazione orizzontale in radianti
        this.pitch = 0.2; // Rotazione verticale in radianti (inizialmente leggermente inclinata)
        
        // Sensibilità controlli
        this.lookSpeedMouse = 0.002;
        this.lookSpeedTouch = 0.004;

        // Stato tastiera PC
        this.keys = {
            KeyW: false,
            KeyS: false,
            KeyA: false,
            KeyD: false,
            ArrowUp: false,
            ArrowDown: false,
            ArrowLeft: false,
            ArrowRight: false
        };

        this.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        this.init();
    }

    init() {
        if (this.isMobile) {
            this.setupMobileControls();
        } else {
            this.setupPCControls();
        }
    }

    setupPCControls() {
        // Pointer Lock API per nascondere il cursore
        document.body.addEventListener('click', () => {
            // Attiva pointer lock solo se il menu principale è già nascosto (il gioco è iniziato)
            const mainMenu = document.getElementById('main-menu');
            if (mainMenu && mainMenu.classList.contains('hidden') && document.pointerLockElement !== document.body) {
                document.body.requestPointerLock();
            }
        });

        // Eventi Tastiera
        window.addEventListener('keydown', (e) => {
            if (e.code in this.keys) {
                this.keys[e.code] = true;
                this.updatePCMoveVector();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code in this.keys) {
                this.keys[e.code] = false;
                this.updatePCMoveVector();
            }
        });

        // Evento Movimento Mouse
        window.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === document.body) {
                this.yaw -= e.movementX * this.lookSpeedMouse;
                this.pitch -= e.movementY * this.lookSpeedMouse;
                
                // Blocca la rotazione verticale per evitare che la telecamera si ribalti
                const maxPitch = Math.PI / 2.5; // ~72 gradi
                this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
            }
        });
    }

    updatePCMoveVector() {
        const forward = (this.keys.KeyW || this.keys.ArrowUp) ? 1 : 0;
        const backward = (this.keys.KeyS || this.keys.ArrowDown) ? 1 : 0;
        const left = (this.keys.KeyA || this.keys.ArrowLeft) ? 1 : 0;
        const right = (this.keys.KeyD || this.keys.ArrowRight) ? 1 : 0;

        // Calcola vettore di movimento relativo locale
        this.moveVector.z = forward - backward; // Asse Z locale (Avanti/Indietro)
        this.moveVector.x = left - right;       // Asse X locale (Sinistra/Destra) - notare inversione per movimento camera

        // Normalizza per evitare movimenti diagonali più veloci
        const length = Math.sqrt(this.moveVector.x * this.moveVector.x + this.moveVector.z * this.moveVector.z);
        if (length > 0) {
            this.moveVector.x /= length;
            this.moveVector.z /= length;
        }
    }

    setupMobileControls() {
        // Mostra i controlli mobile esplicitamente via JS (in aggiunta alle media queries CSS)
        const mobileControls = document.getElementById('mobile-controls');
        if (mobileControls) {
            mobileControls.classList.remove('hidden');
        }

        // --- JOYSTICK VIRTUALE (Sinistra) ---
        const joystickZone = document.getElementById('joystick-zone');
        const joystickBoundary = document.getElementById('joystick-boundary');
        const joystickKnob = document.getElementById('joystick-knob');
        
        let joystickActive = false;
        let startX = 0, startY = 0;
        const maxRadius = 50; // Massima estensione del pomello in pixel

        const onJoystickStart = (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            joystickActive = true;
            
            // Posizione centrale del boundary rispetto allo schermo
            const rect = joystickBoundary.getBoundingClientRect();
            startX = rect.left + rect.width / 2;
            startY = rect.top + rect.height / 2;
        };

        const onJoystickMove = (e) => {
            if (!joystickActive) return;
            e.preventDefault();
            
            // Trova il touch associato alla zona del joystick
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].clientX < window.innerWidth / 2) {
                    touch = e.touches[i];
                    break;
                }
            }
            if (!touch) return;

            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            let angle = Math.atan2(deltaY, deltaX);
            let intensity = Math.min(distance, maxRadius) / maxRadius;

            // Limita la corsa fisica del pomello graficamente
            const knobX = Math.cos(angle) * intensity * maxRadius;
            const knobY = Math.sin(angle) * intensity * maxRadius;
            
            joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

            // Calcola vettore di movimento normalizzato
            // La Y del touch corrisponde a -Z (avanti), la X corrisponde a -X (sinistra)
            this.moveVector.z = -Math.sin(angle) * intensity;
            this.moveVector.x = -Math.cos(angle) * intensity;
        };

        const onJoystickEnd = (e) => {
            joystickActive = false;
            joystickKnob.style.transform = 'translate(0px, 0px)';
            this.moveVector.x = 0;
            this.moveVector.z = 0;
        };

        joystickZone.addEventListener('touchstart', onJoystickStart, { passive: false });
        window.addEventListener('touchmove', onJoystickMove, { passive: false });
        window.addEventListener('touchend', onJoystickEnd);
        window.addEventListener('touchcancel', onJoystickEnd);

        // --- ZONA TOUCH LOOK (Destra) ---
        const touchLookZone = document.getElementById('touch-look-zone');
        let lookActive = false;
        let lastTouchX = 0, lastTouchY = 0;
        let lookTouchId = null;

        touchLookZone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            // Trova l'ultimo touch avvenuto nella metà destra dello schermo
            let touch = null;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].clientX >= window.innerWidth / 2) {
                    touch = e.changedTouches[i];
                    break;
                }
            }
            if (!touch) return;

            lookActive = true;
            lookTouchId = touch.identifier;
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (!lookActive) return;
            
            // Trova il touch corrispondente
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === lookTouchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            if (!touch) return;

            const deltaX = touch.clientX - lastTouchX;
            const deltaY = touch.clientY - lastTouchY;

            this.yaw -= deltaX * this.lookSpeedTouch;
            this.pitch -= deltaY * this.lookSpeedTouch;
            
            const maxPitch = Math.PI / 2.5;
            this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
        }, { passive: false });

        const onLookEnd = (e) => {
            if (!lookActive) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === lookTouchId) {
                    lookActive = false;
                    lookTouchId = null;
                    break;
                }
            }
        };

        window.addEventListener('touchend', onLookEnd);
        window.addEventListener('touchcancel', onLookEnd);
    }
}
