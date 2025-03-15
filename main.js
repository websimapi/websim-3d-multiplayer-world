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
const IDLE_ALT = 'idle_alt'; // Adding alternate idle animation for variety
const JUMPING = 'jumping'; // New jumping animation
const IDLE_ARM_WEIGHT = 0.4;

// Movement variables
const movementSpeed = 5;
const runningSpeed = 10;
const rotationSpeed = 3;
const cameraFollowDistance = 4; // Distance behind player for third-person camera
const cameraHeight = 1.8; // Height of camera in third-person mode
const jumpHeight = 2; // Maximum jump height
const jumpDuration = 0.8; // Time to complete a jump cycle
let movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    running: false,
    jumping: false,
    jumpProgress: 0, // Progress of jump animation (0-1)
    hasMovementChanged: false // Track if movement state has changed
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
                // Create a significantly modified version of idle for a more restful pose
                animations[IDLE_ALT] = mixer.clipAction(animation);
                animations[IDLE_ALT].setEffectiveTimeScale(0.3); // Much slower for a more restful pose
                animations[IDLE_ALT].setEffectiveWeight(IDLE_ARM_WEIGHT); // Reduce intensity to make arms dangle
            } else if (name.includes('walk')) {
                animations[WALKING] = mixer.clipAction(animation);
                animations[WALKING].setEffectiveTimeScale(1.2); // Slightly faster walking animation
            } else if (name.includes('run')) {
                animations[RUNNING] = mixer.clipAction(animation);
            } else if (name.includes('jump')) {
                animations[JUMPING] = mixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!animations[IDLE]) {
            animations[IDLE] = mixer.clipAction(gltf.animations[0]);
            // Modify idle animation to have more natural arm posture
            animations[IDLE].setEffectiveWeight(0.8); // Slightly reduce default movements
        }
        if (!animations[WALKING]) {
            animations[WALKING] = mixer.clipAction(gltf.animations[1] || gltf.animations[0]);
            animations[WALKING].setEffectiveTimeScale(1.2);
        }
        if (!animations[RUNNING]) {
            animations[RUNNING] = mixer.clipAction(gltf.animations[2] || gltf.animations[1] || gltf.animations[0]);
        }
        if (!animations[JUMPING]) {
            // Create jump animation from a running or idle animation if one doesn't exist
            const baseAnim = gltf.animations.find(a => a.name.toLowerCase().includes('run')) || 
                           gltf.animations.find(a => a.name.toLowerCase().includes('idle')) ||
                           gltf.animations[0];
            animations[JUMPING] = mixer.clipAction(baseAnim);
            animations[JUMPING].setEffectiveTimeScale(1.5); // Faster for jump
        }
        
        // Initialize with a longer crossfade to idle for smoothness
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
        controls.enabled = false; // Disable orbit controls for third-person mode
        // Show all parts of the model
        currentPlayerModel.traverse(node => {
            if (node.isMesh) {
                node.visible = true;
            }
        });
        
        // Set camera to behind player position
        const playerRotation = currentPlayerModel.rotation.y;
        camera.position.x = currentPlayerModel.position.x - Math.sin(playerRotation) * cameraFollowDistance;
        camera.position.y = currentPlayerModel.position.y + cameraHeight;
        camera.position.z = currentPlayerModel.position.z - Math.cos(playerRotation) * cameraFollowDistance;
        
        // Look at player
        camera.lookAt(
            currentPlayerModel.position.x,
            currentPlayerModel.position.y + 1,
            currentPlayerModel.position.z
        );
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
    if (movement.jumping) {
        animationState = JUMPING;
    } else if (movement.forward || movement.backward || movement.left || movement.right) {
        animationState = movement.running ? RUNNING : WALKING;
    }
    
    room.party.updatePresence({
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { y: rotation.y },
        animation: animationState,
        timestamp: Date.now(),
        isMoving: movement.forward || movement.backward || movement.left || movement.right,
        isJumping: movement.jumping
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
                // Create a significantly modified version of idle for a more restful pose
                playerAnimations[IDLE_ALT] = playerMixer.clipAction(animation);
                playerAnimations[IDLE_ALT].setEffectiveTimeScale(0.3); // Slower for a more restful pose
                playerAnimations[IDLE_ALT].setEffectiveWeight(IDLE_ARM_WEIGHT); // Reduce intensity for dangling arms
            } else if (name.includes('walk')) {
                playerAnimations[WALKING] = playerMixer.clipAction(animation);
                playerAnimations[WALKING].setEffectiveTimeScale(1.2); // Slightly faster walking
            } else if (name.includes('run')) {
                playerAnimations[RUNNING] = playerMixer.clipAction(animation);
            } else if (name.includes('jump')) {
                playerAnimations[JUMPING] = playerMixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!playerAnimations[IDLE]) {
            playerAnimations[IDLE] = playerMixer.clipAction(gltf.animations[0]);
            playerAnimations[IDLE].setEffectiveWeight(0.8); // Slightly reduce default movements
        }
        if (!playerAnimations[WALKING]) {
            playerAnimations[WALKING] = playerMixer.clipAction(gltf.animations[1] || gltf.animations[0]);
        }
        if (!playerAnimations[RUNNING]) {
            playerAnimations[RUNNING] = playerMixer.clipAction(gltf.animations[2] || gltf.animations[1] || gltf.animations[0]);
        }
        if (!playerAnimations[JUMPING]) {
            const baseAnim = gltf.animations.find(a => a.name.toLowerCase().includes('run')) || 
                           gltf.animations.find(a => a.name.toLowerCase().includes('idle')) ||
                           gltf.animations[0];
            playerAnimations[JUMPING] = playerMixer.clipAction(baseAnim);
            playerAnimations[JUMPING].setEffectiveTimeScale(1.5); // Faster for jump
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
    
    // Update animation if changed - with custom crossfade durations for better transitions
    if (data.animation && data.animation !== player.currentAnimation) {
        if (player.animations[player.currentAnimation]) {
            // Use appropriate fade durations based on animation transition type
            let fadeOutDuration = 0.3;
            // Longer fade when transitioning from movement to idle (stopping)
            if (player.currentAnimation.includes('walk') || player.currentAnimation.includes('run')) {
                if (data.animation.includes('idle')) {
                    fadeOutDuration = 0.5; // Smoother transition when stopping
                }
            }
            player.animations[player.currentAnimation].fadeOut(fadeOutDuration);
        }
        if (player.animations[data.animation]) {
            // Use appropriate fade durations based on animation transition type
            let fadeInDuration = 0.3;
            // Longer fade when transitioning from idle to movement (starting)
            if (player.currentAnimation.includes('idle')) {
                if (data.animation.includes('walk') || data.animation.includes('run')) {
                    fadeInDuration = 0.15; // Quicker transition when starting movement
                }
            }
            player.animations[data.animation].reset().fadeIn(fadeInDuration).play();
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
    let previousMovementState = {
        forward: movement.forward,
        backward: movement.backward,
        left: movement.left,
        right: movement.right,
        running: movement.running
    };
    
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
        case 'Space':
            if (!movement.jumping) {
                movement.jumping = true;
                movement.jumpProgress = 0;
            }
            break;
    }
    
    // Check if movement state has changed
    movement.hasMovementChanged = 
        previousMovementState.forward !== movement.forward ||
        previousMovementState.backward !== movement.backward ||
        previousMovementState.left !== movement.left ||
        previousMovementState.right !== movement.right ||
        previousMovementState.running !== movement.running;
    
    // Don't update animation if typing in chat
    if (document.activeElement !== document.getElementById('chat-input') && movement.hasMovementChanged) {
        updateCharacterAnimation();
    }
}

function onKeyUp(event) {
    let previousMovementState = {
        forward: movement.forward,
        backward: movement.backward,
        left: movement.left,
        right: movement.right,
        running: movement.running
    };
    
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
    
    // Check if movement state has changed
    movement.hasMovementChanged = 
        previousMovementState.forward !== movement.forward ||
        previousMovementState.backward !== movement.backward ||
        previousMovementState.left !== movement.left ||
        previousMovementState.right !== movement.right ||
        previousMovementState.running !== movement.running;
    
    // Don't update animation if typing in chat
    if (document.activeElement !== document.getElementById('chat-input') && movement.hasMovementChanged) {
        updateCharacterAnimation();
        
        // Send an immediate presence update when stopping movement
        // This ensures other players see the idle state change immediately
        if (!movement.forward && !movement.backward && !movement.left && !movement.right) {
            // Small delay before sending idle state to ensure animation has time to transition
            setTimeout(() => {
                updatePresence();
            }, 50);
        }
    }
}

function updateCharacterAnimation() {
    if (!currentPlayerModel || !animations) return;
    
    let newAnimation = IDLE;
    
    // Determine animation based on movement
    if (movement.jumping) {
        newAnimation = JUMPING;
    } else if (movement.forward || movement.backward || movement.left || movement.right) {
        newAnimation = movement.running ? RUNNING : WALKING;
    } else {
        // Occasionally switch between idle animations but much less frequently
        if (Math.random() > 0.997) { // Very rare chance to switch idle animations
            newAnimation = newAnimation === IDLE ? IDLE_ALT : IDLE;
        }
    }
    
    // Get current animation
    const currentAnimation = Object.keys(animations).find(key => 
        animations[key].isRunning() && animations[key].weight > 0.5
    ) || IDLE;
    
    // Skip if animation is already playing
    if (newAnimation === currentAnimation) return;
    
    // Set different crossfade durations based on animation transition type
    let fadeOutDuration = 0.3;
    let fadeInDuration = 0.3;
    
    // Handle specific animation transitions
    if (newAnimation === JUMPING) {
        fadeOutDuration = 0.1; // Very quick transition to jump
        fadeInDuration = 0.1;
    } else if (newAnimation.includes('idle')) {
        // When stopping (transition to idle)
        fadeOutDuration = 0.5; // Longer fade-out from movement
        fadeInDuration = 0.5; // Gradual transition to idle
    } else if (currentAnimation.includes('idle')) {
        // When starting movement from idle
        fadeOutDuration = 0.2; // Quick fade from idle
        fadeInDuration = 0.15; // Very quick transition to movement
    }
    
    // Transition to new animation with appropriate timing
    Object.values(animations).forEach(anim => {
        if (anim.isRunning()) {
            anim.fadeOut(fadeOutDuration);
        }
    });
    
    // Reset animation before playing to ensure it starts from the beginning
    animations[newAnimation].reset();
    animations[newAnimation].fadeIn(fadeInDuration).play();
    
    // Apply animation-specific settings
    if (newAnimation.includes('idle')) {
        animations[newAnimation].setEffectiveWeight(0.8); // Slightly reduce default movements
    } else if (newAnimation === JUMPING) {
        animations[newAnimation].setLoop(THREE.LoopOnce);
        animations[newAnimation].clampWhenFinished = true;
    }
}

function moveCharacter(delta) {
    if (!currentPlayerModel) return;
    
    let moved = false;
    const speed = movement.running ? runningSpeed : movementSpeed;
    
    // Handle jumping
    if (movement.jumping) {
        // Update jump progress
        movement.jumpProgress += delta / jumpDuration;
        
        if (movement.jumpProgress >= 1) {
            movement.jumping = false;
            movement.jumpProgress = 0;
            updateCharacterAnimation(); // Update animation when jump is complete
        } else {
            // Calculate jump height using sine curve for smooth up and down
            const jumpCurve = Math.sin(movement.jumpProgress * Math.PI);
            currentPlayerModel.position.y = jumpCurve * jumpHeight;
            moved = true;
        }
    } else {
        // Make sure character is on the ground when not jumping
        currentPlayerModel.position.y = 0;
    }
    
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
    
    // Left/right strafing in first person or rotation in third person
    if (isFirstPerson) {
        // Strafe in first person
        if (movement.left) {
            currentPlayerModel.position.x += Math.sin(moveAngle - Math.PI/2) * speed * delta;
            currentPlayerModel.position.z += Math.cos(moveAngle - Math.PI/2) * speed * delta;
            moved = true;
        } else if (movement.right) {
            currentPlayerModel.position.x += Math.sin(moveAngle + Math.PI/2) * speed * delta;
            currentPlayerModel.position.z += Math.cos(moveAngle + Math.PI/2) * speed * delta;
            moved = true;
        }
        // Update model rotation to match camera direction
        currentPlayerModel.rotation.y = moveAngle;
    } else {
        // Rotation in third person mode
        if (movement.left) {
            currentPlayerModel.rotation.y += rotationSpeed * delta;
            moved = true;
        } else if (movement.right) {
            currentPlayerModel.rotation.y -= rotationSpeed * delta;
            moved = true;
        }
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
            // Third person - position camera behind player
            const playerRotation = currentPlayerModel.rotation.y;
            
            // Position camera behind player at fixed distance and height
            camera.position.x = currentPlayerModel.position.x - Math.sin(playerRotation) * cameraFollowDistance;
            camera.position.y = currentPlayerModel.position.y + cameraHeight;
            camera.position.z = currentPlayerModel.position.z - Math.cos(playerRotation) * cameraFollowDistance;
            
            // Look at player
            camera.lookAt(
                currentPlayerModel.position.x,
                currentPlayerModel.position.y + 1, // Look at upper body/head
                currentPlayerModel.position.z
            );
            
            // Update orbit controls target
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
    
    // Update controls only if enabled (only when pausing game or UI interactions)
    if (controls.enabled) {
        controls.update();
    }
    
    // Update character movement
    if (document.activeElement !== document.getElementById('chat-input')) {
        moveCharacter(delta);
        
        // Less frequent idle animation switching with more controlled timing
        if (!movement.forward && !movement.backward && !movement.left && !movement.right && !movement.jumping) {
            // Add subtle idle animation variation very rarely
            if (Math.random() > 0.999) { // Even more rare chance to switch idle animations
                const currentIdleAnimation = animations[IDLE].isRunning() && animations[IDLE].weight > 0.5 ? IDLE : IDLE_ALT;
                const newIdleAnimation = currentIdleAnimation === IDLE ? IDLE_ALT : IDLE;
                
                // Longer, gentler crossfade between idle animations
                if (animations[currentIdleAnimation].isRunning()) {
                    animations[currentIdleAnimation].fadeOut(1.5);
                }
                animations[newIdleAnimation].reset().fadeIn(1.5).play();
                
                // Make sure the new idle animation has the right arm weight for natural dangling
                animations[newIdleAnimation].setEffectiveWeight(
                    newIdleAnimation === IDLE_ALT ? IDLE_ARM_WEIGHT : 0.8
                );
                
                updatePresence(); // Update other clients about our animation state
            }
        }
        
        // Handle end of jumping animation
        if (movement.jumping && animations[JUMPING] && !animations[JUMPING].isRunning()) {
            movement.jumping = false;
            updateCharacterAnimation();
            updatePresence();
        }
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