import * as THREE from 'three';

// Funzione helper per generare lo sprite del nickname in 3D
function createNicknameSprite(nickname) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Funzione helper per disegnare un rettangolo arrotondato
    const roundRect = (ctx, x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    // Sfondo glassmorphic semitrasparente
    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    roundRect(ctx, 4, 4, 248, 56, 16);
    ctx.fill();
    
    // Bordo al neon azzurro
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Testo del Nickname
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nickname, 128, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture, 
        depthWrite: false // Evita problemi di clipping trasparente
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(3, 0.75, 1);
    sprite.position.y = 2.4; // Posizionato sopra la testa dell'avatar
    return sprite;
}

// Funzione per creare la mesh dell'avatar (Spirito/Anima al neon)
function createAvatarMesh(colorHex) {
    const mainGroup = new THREE.Group();

    // Gruppo per gli elementi visivi che fluttuano e si animano
    const spiritGroup = new THREE.Group();
    spiritGroup.name = "spiritGroup";
    mainGroup.add(spiritGroup);

    // 1. Nucleo centrale (Sfera luminosa dell'anima)
    const coreGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 2.0,
        roughness: 0.1,
        metalness: 0.1
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 0.8;
    core.castShadow = true;
    core.receiveShadow = true;
    spiritGroup.add(core);

    // 2. Aura esterna (Icosaedro wireframe cangiante)
    const auraGeo = new THREE.IcosahedronGeometry(0.55, 1);
    const auraMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        wireframe: true,
        transparent: true,
        opacity: 0.4
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.y = 0.8;
    aura.name = "aura";
    spiritGroup.add(aura);

    // 3. Anelli orbitali energetici al neon (Torus)
    const ring1Geo = new THREE.TorusGeometry(0.65, 0.015, 8, 32);
    const ringMat1 = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const ring1 = new THREE.Mesh(ring1Geo, ringMat1);
    ring1.position.y = 0.8;
    ring1.name = "ring1";
    ring1.rotation.x = Math.PI / 4;
    spiritGroup.add(ring1);

    const ring2Geo = new THREE.TorusGeometry(0.65, 0.015, 8, 32);
    const ringMat2 = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const ring2 = new THREE.Mesh(ring2Geo, ringMat2);
    ring2.position.y = 0.8;
    ring2.name = "ring2";
    ring2.rotation.x = -Math.PI / 4;
    ring2.rotation.y = Math.PI / 2;
    spiritGroup.add(ring2);

    // 4. Visore/Faro di direzione frontale (Sferetta bianca luminosa a z = 0.45)
    const visorGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const visorMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.8, 0.45);
    spiritGroup.add(visor);

    return mainGroup;
}

// --- CLASSE GIOCATORE LOCALE ---
export class LocalPlayer {
    constructor(nickname, scene) {
        this.nickname = nickname;
        this.scene = scene;
        
        this.position = new THREE.Vector3(0, 0, 0);
        this.rotationY = 0;
        this.speed = 8.0; // Unità al secondo
        this.radius = 0.6; // Raggio del collision cylinder
        this.bobbingTime = Math.random() * 100; // Offset casuale per desincronizzare il bobbing

        // Inizializza l'avatar 3D (Colore azzurro/cyan al neon per il giocatore locale)
        this.mesh = createAvatarMesh(0x00f0ff);
        this.mesh.position.copy(this.position);
        this.scene.add(this.mesh);

        // Aggiungi Nickname sopra la testa
        this.nicknameSprite = createNicknameSprite(nickname);
        this.mesh.add(this.nicknameSprite);

        // Parametri per il salto (saltello)
        this.velocityY = 0;
        this.gravity = 25.0; // Forza di gravità
        this.jumpStrength = 9.0; // Spinta iniziale del salto
        this.isGrounded = true;
    }

    update(dt, input, obstacles, camera) {
        // 1. Calcola il vettore di movimento relativo alla telecamera
        if (input.moveVector.x !== 0 || input.moveVector.z !== 0) {
            // Ottieni la direzione orizzontale in cui guarda la camera
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw).normalize();
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw).normalize();
            
            const moveDirection = new THREE.Vector3();
            // Somma i contributi
            moveDirection.addScaledVector(forward, input.moveVector.z);
            moveDirection.addScaledVector(right, -input.moveVector.x);
            moveDirection.normalize();

            // Calcola il movimento proposto
            const proposedMove = moveDirection.clone().multiplyScalar(this.speed * dt);
            
            // 2. Risolvi le collisioni prima di applicare il movimento
            this.resolveCollisions(proposedMove, obstacles);
            
            // Applica la rotazione dell'avatar nella direzione del movimento
            // Ruota gradualmente verso l'angolo di movimento per fluidità
            const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
            this.rotationY = targetRotation;
            this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, targetRotation, 0.2);
        }

        // Gestione Fisica del Salto (Saltello)
        if (input.keys.Space && this.isGrounded) {
            this.velocityY = this.jumpStrength;
            this.isGrounded = false;
        }

        if (!this.isGrounded) {
            // Se rilasciamo la barra Spazio (o il tocco) mentre stiamo salendo, 
            // tagliamo immediatamente la velocità verticale ad un limite inferiore (minJumpVelocity).
            // Questo rende il saltello breve nettamente distinguibile rispetto al salto completo.
            const cutOffVelocity = this.jumpStrength * 0.35; // ~3.15
            if (!input.keys.Space && this.velocityY > cutOffVelocity) {
                this.velocityY = cutOffVelocity;
            }
            
            this.velocityY -= this.gravity * dt;
            this.mesh.position.y += this.velocityY * dt;

            // Collisione con il pavimento (livello 0)
            if (this.mesh.position.y <= 0) {
                this.mesh.position.y = 0;
                this.velocityY = 0;
                this.isGrounded = true;
            }
        }

        // Aggiorna posizione locale basata sulla mesh
        this.position.copy(this.mesh.position);

        // Accumula il tempo per il bobbing e le rotazioni
        this.bobbingTime += dt;

        // Aggiorna animazioni dello spirito locale
        const spiritGroup = this.mesh.getObjectByName("spiritGroup");
        if (spiritGroup) {
            // Bobbing verticale continuo dell'avatar spirito
            spiritGroup.position.y = Math.sin(this.bobbingTime * 2.5) * 0.12;
            
            // Rotazioni degli anelli ed aura
            const ring1 = spiritGroup.getObjectByName("ring1");
            if (ring1) {
                ring1.rotation.z += 1.0 * dt;
                ring1.rotation.x += 0.5 * dt;
            }
            const ring2 = spiritGroup.getObjectByName("ring2");
            if (ring2) {
                ring2.rotation.z -= 1.2 * dt;
                ring2.rotation.y += 0.6 * dt;
            }
            const aura = spiritGroup.getObjectByName("aura");
            if (aura) {
                aura.rotation.y += 0.3 * dt;
                aura.rotation.x -= 0.15 * dt;
            }
        }

        // 3. Posiziona e orienta la telecamera in terza persona
        const cameraDistance = 7.0;
        const cameraHeightOffset = 1.8;
        
        // Calcola l'offset sferico della camera basato su yaw e pitch
        const offset = new THREE.Vector3(
            Math.sin(input.yaw) * Math.cos(input.pitch) * cameraDistance,
            Math.sin(input.pitch) * cameraDistance + cameraHeightOffset,
            Math.cos(input.yaw) * Math.cos(input.pitch) * cameraDistance
        );

        camera.position.copy(this.position).add(offset);
        
        // Fai guardare la telecamera verso il baricentro dell'avatar (altezza spalle/testa)
        const lookTarget = this.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        camera.lookAt(lookTarget);
    }

    resolveCollisions(proposedMove, obstacles) {
        // Nuova posizione potenziale su X e Z separatamente per scivolamento lungo i muri
        const nextPos = this.mesh.position.clone();
        
        // Collisioni asse X
        nextPos.x += proposedMove.x;
        if (!this.checkCollisionsAt(nextPos, obstacles)) {
            this.mesh.position.x = nextPos.x;
        } else {
            nextPos.x = this.mesh.position.x; // Ripristina
        }

        // Collisioni asse Z
        nextPos.z += proposedMove.z;
        if (!this.checkCollisionsAt(nextPos, obstacles)) {
            this.mesh.position.z = nextPos.z;
        }
    }

    checkCollisionsAt(pos, obstacles) {
        // Controllo limiti della mappa (piano 100x100, limiti -50 a 50)
        const mapLimit = 48.5; // Leggermente all'interno per spessore muro perimetrale
        if (Math.abs(pos.x) > mapLimit || Math.abs(pos.z) > mapLimit) {
            return true;
        }

        // Controlla ogni ostacolo procedurale nella scena
        for (const obs of obstacles) {
            if (obs.type === 'box') {
                // Calcola il bounding box approssimativo dell'ostacolo
                const halfW = obs.width / 2;
                const halfD = obs.depth / 2;

                const minX = obs.position.x - halfW - this.radius;
                const maxX = obs.position.x + halfW + this.radius;
                const minZ = obs.position.z - halfD - this.radius;
                const maxZ = obs.position.z + halfD + this.radius;

                // Se la posizione del giocatore si trova all'interno del box espanso del raggio del player
                if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
                    return true;
                }
            } else {
                // Cilindro o Cono (trattati con collisione sferica orizzontale)
                const dx = pos.x - obs.position.x;
                const dz = pos.z - obs.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                const minDistance = obs.radius + this.radius;
                
                if (distance < minDistance) {
                    return true;
                }
            }
        }
        return false;
    }

    destroy() {
        this.scene.remove(this.mesh);
    }
}

// --- CLASSE GIOCATORI REMOTI ---
export class RemotePlayer {
    constructor(nickname, scene, startPos) {
        this.nickname = nickname;
        this.scene = scene;
        
        // Posizioni target per l'interpolazione fluida
        this.targetPosition = new THREE.Vector3().copy(startPos);
        this.targetRotationY = 0;
        this.bobbingTime = Math.random() * 100; // Offset casuale per desincronizzare il bobbing

        // Inizializza l'avatar 3D (Colore rosa neon per gli altri giocatori)
        this.mesh = createAvatarMesh(0xec4899);
        this.mesh.position.copy(startPos);
        this.scene.add(this.mesh);

        // Aggiungi Nickname sopra la testa del clone remoto
        this.nicknameSprite = createNicknameSprite(nickname);
        this.mesh.add(this.nicknameSprite);
    }

    // Aggiorna lo stato remoto interpolando verso la posizione/rotazione target
    update(dt) {
        const lerpFactor = 0.15; // Velocità di interpolazione (più basso = più morbido ma leggero ritardo, 0.15 è ideale)
        
        // Lerp Posizione
        this.mesh.position.lerp(this.targetPosition, lerpFactor);
        
        // Slerp per rotazione Y (corregge angoli ciclici di 360°)
        let diff = this.targetRotationY - this.mesh.rotation.y;
        
        // Normalizza la differenza dell'angolo tra -PI e PI per ruotare sul percorso più breve
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        
        this.mesh.rotation.y += diff * lerpFactor;

        // Accumula il tempo per il bobbing e le rotazioni
        this.bobbingTime += dt;

        // Aggiorna animazioni dello spirito remoto
        const spiritGroup = this.mesh.getObjectByName("spiritGroup");
        if (spiritGroup) {
            // Bobbing verticale continuo
            spiritGroup.position.y = Math.sin(this.bobbingTime * 2.5) * 0.12;
            
            // Rotazioni degli anelli ed aura
            const ring1 = spiritGroup.getObjectByName("ring1");
            if (ring1) {
                ring1.rotation.z += 1.0 * dt;
                ring1.rotation.x += 0.5 * dt;
            }
            const ring2 = spiritGroup.getObjectByName("ring2");
            if (ring2) {
                ring2.rotation.z -= 1.2 * dt;
                ring2.rotation.y += 0.6 * dt;
            }
            const aura = spiritGroup.getObjectByName("aura");
            if (aura) {
                aura.rotation.y += 0.3 * dt;
                aura.rotation.x -= 0.15 * dt;
            }
        }
    }

    setTransform(pos, rotY) {
        this.targetPosition.set(pos.x, pos.y, pos.z);
        this.targetRotationY = rotY;
    }

    destroy() {
        this.scene.remove(this.mesh);
    }
}
