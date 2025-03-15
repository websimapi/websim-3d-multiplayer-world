import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { gsap } from 'gsap';

// Initialize the multiplayer room
const room = new WebsimSocket();

// Three.js variables
let scene, camera, renderer, labelRenderer, controls;
let terrain;
let clock = new THREE.Clock();
let mixer;
let players = {};
let animations = {};
let currentPlayerModel;
let isFirstPerson = false; // Track camera mode

// Animation states
const IDLE = 'idle';
const WALKING = 'walking';
const RUNNING = 'running';

// Movement variables
const movementSpeed = 5;
const runningSpeed = 10;
const rotationSpeed = 3;
let movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    running: false
};

// Player model URL
const characterModelUrl = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/Xbot.glb';

// Initialize the scene
init();
animate();

function init() {
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
    
    // Create lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // Create terrain
    createTerrain();
    
    // Load character model
    loadCharacterModel();
    
    // Event listeners
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    // Add toggle for first person view
    document.addEventListener('keypress', (event) => {
        if (event.code === 'KeyV') {
            toggleCameraView();
        }
    });
    
    // Set up chat input
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && chatInput.value.trim() !== '') {
            sendChat(chatInput.value);
            chatInput.value = '';
        }
    });
    
    // Update player info
    updatePlayerInfo();
    
    // Multiplayer setup
    setupMultiplayer();
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

function loadCharacterModel() {
    const loader = new GLTFLoader();
    loader.load(characterModelUrl, (gltf) => {
        currentPlayerModel = gltf.scene;
        currentPlayerModel.scale.set(1, 1, 1);
        currentPlayerModel.position.y = 0;
        currentPlayerModel.castShadow = true;
        currentPlayerModel.traverse(node => {
            if (node.isMesh) {
                node.castShadow = true;
            }
        });
        
        // Set up animations
        mixer = new THREE.AnimationMixer(currentPlayerModel);
        
        // Store all animations
        gltf.animations.forEach(animation => {
            const name = animation.name.toLowerCase();
            if (name.includes('idle')) {
                animations[IDLE] = mixer.clipAction(animation);
            } else if (name.includes('walk')) {
                animations[WALKING] = mixer.clipAction(animation);
            } else if (name.includes('run')) {
                animations[RUNNING] = mixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!animations[IDLE]) {
            animations[IDLE] = mixer.clipAction(gltf.animations[0]);
        }
        if (!animations[WALKING]) {
            animations[WALKING] = mixer.clipAction(gltf.animations[1] || gltf.animations[0]);
        }
        if (!animations[RUNNING]) {
            animations[RUNNING] = mixer.clipAction(gltf.animations[2] || gltf.animations[1] || gltf.animations[0]);
        }
        
        // Add a camera position for first person view
        const headBone = findHeadBone(currentPlayerModel);
        if (headBone) {
            const fpCameraPosition = new THREE.Object3D();
            fpCameraPosition.position.set(0, 0.2, 0.1); // Slightly in front of head
            headBone.add(fpCameraPosition);
            currentPlayerModel.userData.fpCameraPosition = fpCameraPosition;
        }
        
        // Start with idle animation
        animations[IDLE].play();
        
        // Add to scene and update presence
        scene.add(currentPlayerModel);
        updatePresence();
    });
}

// Helper function to find the head bone
function findHeadBone(model) {
    let headBone = null;
    model.traverse((node) => {
        if (node.isBone && (node.name.includes('Head') || node.name.includes('head'))) {
            headBone = node;
        }
    });
    return headBone;
}

function toggleCameraView() {
    if (!currentPlayerModel) return;
    
    isFirstPerson = !isFirstPerson;
    
    if (isFirstPerson) {
        // Switch to first person
        controls.enabled = false;
        // Hide player model or just head
        currentPlayerModel.traverse(node => {
            if (node.isMesh && (node.name.includes('Head') || node.name.includes('head'))) {
                node.visible = false;
            }
        });
    } else {
        // Switch back to third person
        controls.enabled = true;
        // Show all parts of the model
        currentPlayerModel.traverse(node => {
            if (node.isMesh) {
                node.visible = true;
            }
        });
    }
}

function setupMultiplayer() {
    // Subscribe to peer changes
    room.party.subscribe(updateConnectedPlayers);
    
    // Subscribe to presence changes
    room.party.subscribePresence(updatePlayers);
    
    // Handle messages
    room.onmessage = (event) => {
        const data = event.data;
        
        switch (data.type) {
            case 'connected':
                console.log(`${data.username} connected`);
                break;
                
            case 'disconnected':
                console.log(`${data.username} disconnected`);
                removePlayer(data.clientId);
                break;
                
            case 'chat':
                handleChatMessage(data.clientId, data.message);
                break;
        }
    };
}

function updatePresence() {
    if (!currentPlayerModel) return;
    
    const position = currentPlayerModel.position;
    const rotation = currentPlayerModel.rotation;
    
    // Get current animation state
    let animationState = IDLE;
    if (movement.forward || movement.backward || movement.left || movement.right) {
        animationState = movement.running ? RUNNING : WALKING;
    }
    
    room.party.updatePresence({
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { y: rotation.y },
        animation: animationState,
        timestamp: Date.now() // Add timestamp for smoother interpolation
    });
}

function updatePlayers(presence) {
    for (const clientId in presence) {
        const data = presence[clientId];
        const isCurrentPlayer = clientId === room.party.client.id;
        
        if (!isCurrentPlayer) {
            if (!players[clientId]) {
                createPlayer(clientId, data);
            } else {
                updatePlayer(clientId, data);
            }
        }
    }
}

function createPlayer(clientId, data) {
    if (!data.position) return;
    
    const username = room.party.peers[clientId]?.username || 'Unknown';
    
    const loader = new GLTFLoader();
    loader.load(characterModelUrl, (gltf) => {
        const playerModel = gltf.scene;
        playerModel.scale.set(1, 1, 1);
        playerModel.position.set(
            data.position.x || 0,
            data.position.y || 0,
            data.position.z || 0
        );
        
        if (data.rotation) {
            playerModel.rotation.y = data.rotation.y || 0;
        }
        
        playerModel.castShadow = true;
        playerModel.traverse(node => {
            if (node.isMesh) {
                node.castShadow = true;
            }
        });
        
        // Create name label
        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-label';
        nameDiv.textContent = username;
        nameDiv.style.color = 'white';
        nameDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        nameDiv.style.padding = '2px 5px';
        nameDiv.style.borderRadius = '3px';
        nameDiv.style.fontSize = '12px';
        nameDiv.style.pointerEvents = 'none';
        
        const nameLabel = new CSS2DObject(nameDiv);
        nameLabel.position.set(0, 2.2, 0);
        playerModel.add(nameLabel);
        
        // Create chat bubble
        const chatDiv = document.createElement('div');
        chatDiv.className = 'chat-bubble';
        chatDiv.style.color = 'black';
        chatDiv.style.backgroundColor = 'white';
        chatDiv.style.padding = '5px 10px';
        chatDiv.style.borderRadius = '10px';
        chatDiv.style.fontSize = '14px';
        chatDiv.style.maxWidth = '200px';
        chatDiv.style.textAlign = 'center';
        chatDiv.style.display = 'none';
        chatDiv.style.pointerEvents = 'none';
        
        const chatBubble = new CSS2DObject(chatDiv);
        chatBubble.position.set(0, 2.5, 0);
        playerModel.add(chatBubble);
        
        // Set up animations
        const playerMixer = new THREE.AnimationMixer(playerModel);
        
        const playerAnimations = {};
        
        gltf.animations.forEach(animation => {
            const name = animation.name.toLowerCase();
            if (name.includes('idle')) {
                playerAnimations[IDLE] = playerMixer.clipAction(animation);
            } else if (name.includes('walk')) {
                playerAnimations[WALKING] = playerMixer.clipAction(animation);
            } else if (name.includes('run')) {
                playerAnimations[RUNNING] = playerMixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!playerAnimations[IDLE]) {
            playerAnimations[IDLE] = playerMixer.clipAction(gltf.animations[0]);
        }
        if (!playerAnimations[WALKING]) {
            playerAnimations[WALKING] = playerMixer.clipAction(gltf.animations[1] || gltf.animations[0]);
        }
        if (!playerAnimations[RUNNING]) {
            playerAnimations[RUNNING] = playerMixer.clipAction(gltf.animations[2] || gltf.animations[1] || gltf.animations[0]);
        }
        
        // Start with appropriate animation
        const initialAnimation = data.animation || IDLE;
        playerAnimations[initialAnimation].play();
        
        // Store player data
        players[clientId] = {
            model: playerModel,
            mixer: playerMixer,
            animations: playerAnimations,
            nameLabel,
            chatBubble,
            currentAnimation: initialAnimation
        };
        
        // Add to scene
        scene.add(playerModel);
    });
}

function updatePlayer(clientId, data) {
    const player = players[clientId];
    if (!player || !data.position) return;
    
    // Calculate smoother interpolation based on timestamp
    const now = Date.now();
    const timeDiff = now - (data.timestamp || now);
    const interpolationDuration = Math.min(0.2, Math.max(0.05, timeDiff / 1000));
    
    // Update position with smooth transition
    gsap.to(player.model.position, {
        x: data.position.x,
        y: data.position.y,
        z: data.position.z,
        duration: interpolationDuration,
        ease: 'linear'
    });
    
    // Update rotation with smooth transition
    if (data.rotation) {
        gsap.to(player.model.rotation, {
            y: data.rotation.y,
            duration: interpolationDuration,
            ease: 'linear'
        });
    }
    
    // Update animation if changed
    if (data.animation && data.animation !== player.currentAnimation) {
        const currentAnim = player.animations[player.currentAnimation];
        const newAnim = player.animations[data.animation];
        
        if (currentAnim && newAnim) {
            currentAnim.fadeOut(0.2);
            newAnim.reset().fadeIn(0.2).play();
            player.currentAnimation = data.animation;
        }
    }
}

function removePlayer(clientId) {
    const player = players[clientId];
    if (player) {
        scene.remove(player.model);
        delete players[clientId];
    }
}

function sendChat(message) {
    // Send chat message event
    room.send({
        type: 'chat',
        message: message
    });
    
    // Show chat above current player
    handleChatMessage(room.party.client.id, message);
}

function handleChatMessage(clientId, message) {
    // For the current player
    if (clientId === room.party.client.id && currentPlayerModel) {
        // Create a temporary chat bubble if it doesn't exist
        if (!players[clientId]) {
            const chatDiv = document.createElement('div');
            chatDiv.className = 'chat-bubble';
            chatDiv.style.color = 'black';
            chatDiv.style.backgroundColor = 'white';
            chatDiv.style.padding = '5px 10px';
            chatDiv.style.borderRadius = '10px';
            chatDiv.style.fontSize = '14px';
            chatDiv.style.maxWidth = '200px';
            chatDiv.style.textAlign = 'center';
            
            const chatBubble = new CSS2DObject(chatDiv);
            chatBubble.position.set(0, 2.5, 0);
            currentPlayerModel.add(chatBubble);
            
            players[clientId] = { chatBubble: chatBubble };
        }
        
        const chatBubble = players[clientId].chatBubble;
        chatBubble.element.textContent = message;
        chatBubble.element.style.display = 'block';
        
        // Hide chat bubble after 5 seconds
        setTimeout(() => {
            chatBubble.element.style.display = 'none';
        }, 5000);
    } 
    // For other players
    else if (players[clientId]) {
        const chatBubble = players[clientId].chatBubble;
        chatBubble.element.textContent = message;
        chatBubble.element.style.display = 'block';
        
        // Hide chat bubble after 5 seconds
        setTimeout(() => {
            chatBubble.element.style.display = 'none';
        }, 5000);
    }
}

function updatePlayerInfo() {
    const clientId = room.party.client.id;
    const username = room.party.client.username;
    
    document.getElementById('player-info').innerText = `ID: ${clientId}\nUsername: ${username}`;
}

function updateConnectedPlayers(peers) {
    const count = Object.keys(peers).length;
    document.getElementById('connected-players').innerText = `Players: ${count}`;
}

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            movement.forward = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            movement.backward = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            movement.left = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            movement.right = true;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            movement.running = true;
            break;
    }
    
    // Don't update animation if typing in chat
    if (document.activeElement !== document.getElementById('chat-input')) {
        updateCharacterAnimation();
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            movement.forward = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            movement.backward = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            movement.left = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            movement.right = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            movement.running = false;
            break;
    }
    
    // Don't update animation if typing in chat
    if (document.activeElement !== document.getElementById('chat-input')) {
        updateCharacterAnimation();
    }
}

function updateCharacterAnimation() {
    if (!currentPlayerModel || !animations) return;
    
    let newAnimation = IDLE;
    
    // Determine animation based on movement
    if (movement.forward || movement.backward || movement.left || movement.right) {
        newAnimation = movement.running ? RUNNING : WALKING;
    }
    
    // Skip if animation is already playing
    if (newAnimation === Object.keys(animations).find(key => 
        animations[key].isRunning() && animations[key].weight === 1
    )) return;
    
    // Transition to new animation
    Object.values(animations).forEach(anim => {
        anim.fadeOut(0.2);
    });
    animations[newAnimation].reset().fadeIn(0.2).play();
}

function moveCharacter(delta) {
    if (!currentPlayerModel) return;
    
    let moved = false;
    const speed = movement.running ? runningSpeed : movementSpeed;
    
    // Calculate movement direction based on camera or character facing
    let moveAngle = currentPlayerModel.rotation.y;
    if (isFirstPerson) {
        // In first person, move in the direction the camera is facing
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        moveAngle = Math.atan2(cameraDirection.x, cameraDirection.z);
    }
    
    // Forward/backward movement
    if (movement.forward) {
        currentPlayerModel.position.x += Math.sin(moveAngle) * speed * delta;
        currentPlayerModel.position.z += Math.cos(moveAngle) * speed * delta;
        moved = true;
    } else if (movement.backward) {
        currentPlayerModel.position.x -= Math.sin(moveAngle) * speed * delta;
        currentPlayerModel.position.z -= Math.cos(moveAngle) * speed * delta;
        moved = true;
    }
    
    // Rotation for left/right in third person mode
    if (!isFirstPerson) {
        if (movement.left) {
            currentPlayerModel.rotation.y += rotationSpeed * delta;
            moved = true;
        } else if (movement.right) {
            currentPlayerModel.rotation.y -= rotationSpeed * delta;
            moved = true;
        }
    } else {
        // In first person, rotate with mouse and update model rotation
        currentPlayerModel.rotation.y = moveAngle;
        moved = true;
    }
    
    // Update camera position based on view mode
    if (moved) {
        if (isFirstPerson && currentPlayerModel.userData.fpCameraPosition) {
            // First person - position camera at head
            const fpCameraWorldPosition = new THREE.Vector3();
            currentPlayerModel.userData.fpCameraPosition.getWorldPosition(fpCameraWorldPosition);
            camera.position.copy(fpCameraWorldPosition);
            
            // Make camera look in the same direction as the model
            camera.lookAt(
                camera.position.x + Math.sin(moveAngle),
                camera.position.y,
                camera.position.z + Math.cos(moveAngle)
            );
        } else {
            // Third person - update orbit controls
            controls.target.copy(currentPlayerModel.position);
        }
        
        // Update the player's position in the multiplayer room
        updatePresence();
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update controls only in third person mode
    if (!isFirstPerson) {
        controls.update();
    }
    
    // Update character movement
    if (document.activeElement !== document.getElementById('chat-input')) {
        moveCharacter(delta);
    }
    
    // Update character animations
    if (mixer) {
        mixer.update(delta);
    }
    
    // Update other players' animations
    for (const id in players) {
        if (players[id].mixer) {
            players[id].mixer.update(delta);
        }
    }
    
    // Render
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}