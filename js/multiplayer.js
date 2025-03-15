import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { gsap } from 'gsap';
import { getScene, getPlayers, setPlayers } from './scene.js';
import { loadCharacterModel, updatePresence, IDLE, WALKING, RUNNING, JUMPING, IDLE_ALT, IDLE_ARM_WEIGHT } from './character.js';

const characterModelUrl = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/Xbot.glb';

export function setupMultiplayer(room) {
    // Load character model for current player
    loadCharacterModel(room);
    
    // Subscribe to peer changes
    room.party.subscribe(updateConnectedPlayers);
    
    // Subscribe to presence changes
    room.party.subscribePresence(data => updatePlayers(data, room));
    
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
                handleChatMessage(data.clientId, data.message, room);
                break;
        }
    };
    
    // Set up chat input
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && chatInput.value.trim() !== '') {
            sendChat(chatInput.value, room);
            chatInput.value = '';
        }
    });
    
    // Update player info
    updatePlayerInfo(room);
}

function updatePlayers(presence, room) {
    let players = getPlayers();
    
    for (const clientId in presence) {
        const data = presence[clientId];
        const isCurrentPlayer = clientId === room.party.client.id;
        
        if (!isCurrentPlayer) {
            if (!players[clientId]) {
                createPlayer(clientId, data, room);
            } else {
                updatePlayer(clientId, data);
            }
        }
    }
}

function createPlayer(clientId, data, room) {
    if (!data.position) return;
    
    const username = room.party.peers[clientId]?.username || 'Unknown';
    let players = getPlayers();
    
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
                playerAnimations[IDLE_ALT] = playerMixer.clipAction(animation);
                playerAnimations[IDLE_ALT].setEffectiveTimeScale(0.3);
                playerAnimations[IDLE_ALT].setEffectiveWeight(IDLE_ARM_WEIGHT);
            } else if (name.includes('walk')) {
                playerAnimations[WALKING] = playerMixer.clipAction(animation);
                playerAnimations[WALKING].setEffectiveTimeScale(1.2);
            } else if (name.includes('run')) {
                playerAnimations[RUNNING] = playerMixer.clipAction(animation);
            } else if (name.includes('jump')) {
                playerAnimations[JUMPING] = playerMixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!playerAnimations[IDLE]) {
            playerAnimations[IDLE] = playerMixer.clipAction(gltf.animations[0]);
            playerAnimations[IDLE].setEffectiveWeight(0.8);
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
            playerAnimations[JUMPING].setEffectiveTimeScale(1.5);
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
        
        // Update players object
        setPlayers(players);
        
        // Add to scene
        getScene().add(playerModel);
    });
}

function updatePlayer(clientId, data) {
    const players = getPlayers();
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
        if (player.animations[player.currentAnimation]) {
            // Use appropriate fade durations based on animation transition type
            let fadeOutDuration = 0.3;
            // Longer fade when transitioning from movement to idle (stopping)
            if (player.currentAnimation.includes('walk') || player.currentAnimation.includes('run')) {
                if (data.animation.includes('idle')) {
                    fadeOutDuration = 0.5;
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
                    fadeInDuration = 0.15;
                }
            }
            player.animations[data.animation].reset().fadeIn(fadeInDuration).play();
            player.currentAnimation = data.animation;
        }
    }
}

function removePlayer(clientId) {
    const players = getPlayers();
    const player = players[clientId];
    if (player) {
        getScene().remove(player.model);
        delete players[clientId];
        setPlayers(players);
    }
}

function sendChat(message, room) {
    // Send chat message event
    room.send({
        type: 'chat',
        message: message
    });
    
    // Show chat above current player
    handleChatMessage(room.party.client.id, message, room);
}

function handleChatMessage(clientId, message, room) {
    const players = getPlayers();
    
    // For the current player
    if (clientId === room.party.client.id) {
        const currentPlayerModel = document.getElementById('current-player-model');
        
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
            setPlayers(players);
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

function updateConnectedPlayers(peers) {
    const count = Object.keys(peers).length;
    document.getElementById('connected-players').innerText = `Players: ${count}`;
}

function updatePlayerInfo(room) {
    const clientId = room.party.client.id;
    const username = room.party.client.username;
    
    document.getElementById('player-info').innerText = `ID: ${clientId}\nUsername: ${username}`;
}