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
        this.scene.background = new THREE.Color(0x050508); // Sfondo scuro nebbioso
        this.scene.fog = new THREE.FogExp2(0x050508, 0.08); // Nebbia densa in stile Silent Hill

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
        this.renderer.toneMappingExposure = 1.2;
        this.container.appendChild(this.renderer.domElement);

        // 4. Illuminazione
        // Luce Ambientale soffusa
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
        this.scene.add(ambientLight);

        // Luce Direzionale (Simulazione Luna fioca) che proietta ombre delicate
        const dirLight = new THREE.DirectionalLight(0xdbeafe, 0.4);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 100;
        
        const d = 40;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.bias = -0.0005;
        this.scene.add(dirLight);

        // Luce d'accento colorata neon (Fiume)
        const pointLight = new THREE.PointLight(0x00f0ff, 2.0, 60);
        pointLight.position.set(25, 5, 0);
        pointLight.castShadow = true;
        this.scene.add(pointLight);
    }

    createEnvironment() {
        // 1. Pavimento
        const floorSize = 100;
        const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
        
        // Texture procedurale scura per la griglia del pavimento
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#06060c';
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = '#12121f';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, 128, 128);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(floorSize / 2, floorSize / 2);

        const floorMat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.9,
            metalness: 0.1
        });

        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // 2. Griglia di riferimento sottile
        const gridHelper = new THREE.GridHelper(floorSize, floorSize / 2, 0x00f0ff, 0x12121f);
        gridHelper.position.y = 0.005; // Evita z-fighting
        gridHelper.material.opacity = 0.08;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);

        // 3. Fiume Neon che attraversa la mappa di lato (a x = 25)
        const riverWidth = 8;
        const riverGeo = new THREE.PlaneGeometry(riverWidth, floorSize);
        const riverMat = new THREE.MeshStandardMaterial({
            color: 0x006699,
            emissive: 0x002244,
            roughness: 0.05,
            metalness: 0.9,
            transparent: true,
            opacity: 0.8
        });
        const river = new THREE.Mesh(riverGeo, riverMat);
        river.rotation.x = -Math.PI / 2;
        river.position.set(25, 0.01, 0);
        river.receiveShadow = true;
        this.scene.add(river);

        // Linee neon di sponda (rive del fiume)
        const borderGeo = new THREE.BoxGeometry(0.15, 0.03, floorSize);
        const leftBorderMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const rightBorderMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

        const leftBank = new THREE.Mesh(borderGeo, leftBorderMat);
        leftBank.position.set(21, 0.02, 0);
        this.scene.add(leftBank);

        const rightBank = new THREE.Mesh(borderGeo, rightBorderMat);
        rightBank.position.set(29, 0.02, 0);
        this.scene.add(rightBank);

        // 4. Panchina sulla riva del fiume (a x = 18, z = 0, rivolta verso il fiume)
        const benchGroup = new THREE.Group();
        benchGroup.position.set(18, 0, 0);
        benchGroup.rotation.y = Math.PI / 2; // Ruota per guardare verso est (il fiume)

        const benchColor = 0x101018; // Scuro profondo metallico
        const benchNeonColor = 0xff007f; // Neon rosa/magenta
        
        const metalMat = new THREE.MeshStandardMaterial({
            color: benchColor,
            roughness: 0.5,
            metalness: 0.7
        });
        const neonMat = new THREE.MeshBasicMaterial({
            color: benchNeonColor
        });

        // Seduta della panchina
        const seatGeo = new THREE.BoxGeometry(3, 0.08, 0.8);
        const seat = new THREE.Mesh(seatGeo, metalMat);
        seat.position.y = 0.5;
        seat.castShadow = true;
        seat.receiveShadow = true;
        benchGroup.add(seat);

        // Schienale
        const backrestGeo = new THREE.BoxGeometry(3, 0.55, 0.08);
        const backrest = new THREE.Mesh(backrestGeo, metalMat);
        backrest.position.set(0, 0.95, -0.36);
        backrest.castShadow = true;
        benchGroup.add(backrest);

        // 4 Gambe
        const legGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
        const legs = [
            [-1.4, 0.25, -0.35],
            [1.4, 0.25, -0.35],
            [-1.4, 0.25, 0.35],
            [1.4, 0.25, 0.35]
        ];
        legs.forEach(pos => {
            const leg = new THREE.Mesh(legGeo, metalMat);
            leg.position.set(pos[0], pos[1], pos[2]);
            leg.castShadow = true;
            benchGroup.add(leg);
        });

        // Decorazioni Neon sulla panchina
        const frontNeonGeo = new THREE.BoxGeometry(3.02, 0.03, 0.03);
        const frontNeon = new THREE.Mesh(frontNeonGeo, neonMat);
        frontNeon.position.set(0, 0.5, 0.41);
        benchGroup.add(frontNeon);

        const topNeonGeo = new THREE.BoxGeometry(3.02, 0.03, 0.03);
        const topNeon = new THREE.Mesh(topNeonGeo, neonMat);
        topNeon.position.set(0, 1.23, -0.36);
        benchGroup.add(topNeon);

        this.scene.add(benchGroup);

        // Aggiungi la panchina alla lista ostacoli per abilitare le collisioni
        this.obstacles.push({
            mesh: benchGroup,
            type: 'box',
            position: new THREE.Vector3(18, 0.5, 0),
            width: 1.0, // Spessore (asse X)
            depth: 3.2  // Lunghezza (asse Z)
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
