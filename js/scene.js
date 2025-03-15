import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { getAnimationState, moveCharacter, updateCharacterAnimation } from './character.js';
import { isFirstPerson, toggleCameraView } from './camera.js';

// Three.js variables
let scene, camera, renderer, labelRenderer, controls;
let terrain;
let clock = new THREE.Clock();
let players = {};

// Export scene objects for use in other modules
export function getScene() {
    return scene;
}

export function getCamera() {
    return camera;
}

export function getPlayers() {
    return players;
}

export function setPlayers(newPlayers) {
    players = newPlayers;
}

export function initScene(room) {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue background
    
    // Add fog for depth
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.01);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5);
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('scene-container').appendChild(renderer.domElement);
    
    // Create CSS2D renderer for labels
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('scene-container').appendChild(labelRenderer.domElement);
    
    // Create controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground
    controls.minDistance = 2;
    controls.maxDistance = 10;
    
    // Make controls available to camera module
    import('./camera.js').then(cameraModule => {
        cameraModule.setControls(controls);
    });
    
    // Create lighting
    createLights();
    
    // Create terrain
    createTerrain();
    
    // Event listeners
    window.addEventListener('resize', onWindowResize);
    
    // Add toggle for first person view
    document.addEventListener('keypress', (event) => {
        if (event.code === 'KeyV') {
            toggleCameraView();
        }
    });
}

function createLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
}

function createTerrain() {
    // Create a large flat terrain
    const terrainGeometry = new THREE.PlaneGeometry(100, 100);
    const terrainMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x7cfc00,
        roughness: 0.8,
        metalness: 0.1
    });
    terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);
    
    // Add a grid helper for reference
    const gridHelper = new THREE.GridHelper(100, 100);
    scene.add(gridHelper);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

export function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update controls only if enabled
    if (controls.enabled) {
        controls.update();
    }
    
    // Update character movement if not typing in chat
    if (document.activeElement !== document.getElementById('chat-input')) {
        moveCharacter(delta);
    }
    
    // Update animations for all players
    for (const id in players) {
        if (players[id].mixer) {
            players[id].mixer.update(delta);
        }
    }
    
    // Render
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}