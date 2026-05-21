import * as THREE from 'three';

export class Engine {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.obstacles = []; // Lista di collisioni per il player
        
        this.init();
        this.createEnvironment();
        this.setupResize();
    }

    init() {
        // 1. Creazione Scena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0f); // Sfondo scuro coerente con il design
        this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015); // Nebbia morbida per profondità

        // 2. Creazione Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        
        // 3. Renderer con Ombre abilitate
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Ottimizzato per schermi Retina/High-DPI
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // 4. Illuminazione
        // Luce Ambientale soffusa
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Luce Direzionale (Simulazione Sole/Luna) che proietta ombre
        const dirLight = new THREE.DirectionalLight(0xdbeafe, 0.8);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 100;
        
        const d = 40;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.bias = -0.0005;
        this.scene.add(dirLight);

        // Luce d'accento colorata (Stile Cyberpunk/Metaverso)
        const pointLight = new THREE.PointLight(0x00f0ff, 1.5, 50);
        pointLight.position.set(0, 10, 0);
        pointLight.castShadow = true;
        this.scene.add(pointLight);
    }

    createEnvironment() {
        // 1. Pavimento
        const floorSize = 100;
        const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
        
        // Texture procedurale per la griglia del pavimento
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#11111a';
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = '#222235';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 128, 128);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(floorSize / 2, floorSize / 2);

        const floorMat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.8,
            metalness: 0.2
        });

        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // 2. Griglia di riferimento
        const gridHelper = new THREE.GridHelper(floorSize, floorSize / 2, 0x00f0ff, 0x222235);
        gridHelper.position.y = 0.01; // Evita z-fighting
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);

        // 3. Ostacoli procedurali (Low-Poly) per potersi nascondere
        const obstacleColors = [0x3b82f6, 0xa855f7, 0xec4899, 0x10b981, 0xf59e0b];
        
        // Muri perimetrali
        this.createWall(0, 0.5 * 100, 100, 10, true);  // Nord
        this.createWall(0, -0.5 * 100, 100, 10, true); // Sud
        this.createWall(0.5 * 100, 0, 10, 100, true);  // Est
        this.createWall(-0.5 * 100, 0, 10, 100, true); // Ovest

        // Ostacoli casuali all'interno della mappa
        const seedRandom = (s) => {
            let t = s % 2147483647;
            if (t <= 0) t += 2147483646;
            return () => {
                t = t * 16807 % 2147483647;
                return (t - 1) / 2147483646;
            };
        };

        const random = seedRandom(42); // Seed fisso per avere la stessa mappa per tutti

        for (let i = 0; i < 25; i++) {
            const width = random() * 6 + 2;
            const height = random() * 8 + 3;
            const depth = random() * 6 + 2;
            
            const x = (random() - 0.5) * 80;
            const z = (random() - 0.5) * 80;

            // Evita di creare ostacoli troppo vicini allo spawn (0,0)
            if (Math.sqrt(x*x + z*z) < 10) continue;

            const color = obstacleColors[Math.floor(random() * obstacleColors.length)];
            
            // Decidi se creare una colonna, una scatola o un pilastro
            let geometry;
            const randType = random();
            if (randType < 0.4) {
                geometry = new THREE.BoxGeometry(width, height, depth);
            } else if (randType < 0.7) {
                geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 8);
            } else {
                // Una sorta di piramide/cono low-poly (albero astratto)
                geometry = new THREE.ConeGeometry(width, height, 6);
            }

            const material = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.5,
                metalness: 0.1,
                flatShading: true // Effetto low-poly accentuato
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, height / 2, z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            this.scene.add(mesh);

            // Aggiungi alla lista degli ostacoli per le collisioni del player
            // Salviamo il bounding box e i dati fisici
            this.obstacles.push({
                mesh: mesh,
                type: randType < 0.4 ? 'box' : (randType < 0.7 ? 'cylinder' : 'cone'),
                position: mesh.position.clone(),
                radius: width / 2,
                width: width,
                depth: depth
            });
        }
    }

    createWall(x, z, w, h, isNorthSouth) {
        const wallThickness = 1.0;
        const width = isNorthSouth ? w : wallThickness;
        const depth = isNorthSouth ? wallThickness : h;
        
        const geometry = new THREE.BoxGeometry(width, 6, depth);
        const material = new THREE.MeshStandardMaterial({
            color: 0x11111b,
            roughness: 0.9,
            metalness: 0.1,
            transparent: true,
            opacity: 0.4 // Muri perimetrali semi-trasparenti
        });
        
        const wall = new THREE.Mesh(geometry, material);
        wall.position.set(x, 3, z);
        this.scene.add(wall);
        
        this.obstacles.push({
            mesh: wall,
            type: 'box',
            position: wall.position.clone(),
            width: width,
            depth: depth
        });
    }

    setupResize() {
        window.addEventListener('resize', () => {
            if (!this.camera || !this.renderer) return;
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
