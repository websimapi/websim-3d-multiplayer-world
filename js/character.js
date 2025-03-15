import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { gsap } from 'gsap';
import { getScene, getCamera, getPlayers } from './scene.js';
import { isFirstPerson, toggleCameraView, updateCameraPosition } from './camera.js';

// Character model URL
const characterModelUrl = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/Xbot.glb';

// Animation states
export const IDLE = 'idle';
export const WALKING = 'walking';
export const RUNNING = 'running';
export const IDLE_ALT = 'idle_alt';
export const JUMPING = 'jumping';
export const IDLE_ARM_WEIGHT = 0.4;

// Player variables
let currentPlayerModel;
let mixer;
let animations = {};

// Movement variables
const movementSpeed = 5;
const runningSpeed = 10;
const rotationSpeed = 3;
const jumpHeight = 2;
const jumpDuration = 0.8;
export let movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    running: false,
    jumping: false,
    jumpProgress: 0,
    hasMovementChanged: false
};

export function loadCharacterModel(room) {
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
                animations[IDLE_ALT] = mixer.clipAction(animation);
                animations[IDLE_ALT].setEffectiveTimeScale(0.3);
                animations[IDLE_ALT].setEffectiveWeight(IDLE_ARM_WEIGHT);
            } else if (name.includes('walk')) {
                animations[WALKING] = mixer.clipAction(animation);
                animations[WALKING].setEffectiveTimeScale(1.2);
            } else if (name.includes('run')) {
                animations[RUNNING] = mixer.clipAction(animation);
            } else if (name.includes('jump')) {
                animations[JUMPING] = mixer.clipAction(animation);
            }
        });
        
        // If specific animations aren't found, use defaults
        if (!animations[IDLE]) {
            animations[IDLE] = mixer.clipAction(gltf.animations[0]);
            animations[IDLE].setEffectiveWeight(0.8);
        }
        if (!animations[WALKING]) {
            animations[WALKING] = mixer.clipAction(gltf.animations[1] || gltf.animations[0]);
            animations[WALKING].setEffectiveTimeScale(1.2);
        }
        if (!animations[RUNNING]) {
            animations[RUNNING] = mixer.clipAction(gltf.animations[2] || gltf.animations[1] || gltf.animations[0]);
        }
        if (!animations[JUMPING]) {
            const baseAnim = gltf.animations.find(a => a.name.toLowerCase().includes('run')) || 
                           gltf.animations.find(a => a.name.toLowerCase().includes('idle')) ||
                           gltf.animations[0];
            animations[JUMPING] = mixer.clipAction(baseAnim);
            animations[JUMPING].setEffectiveTimeScale(1.5);
        }
        
        // Initialize with a longer crossfade to idle for smoothness
        animations[IDLE].play();
        
        // Add to scene
        getScene().add(currentPlayerModel);
        
        // Update presence
        updatePresence(room);
    });
}

export function updateCharacterAnimation() {
    if (!currentPlayerModel || !animations) return;
    
    let newAnimation = IDLE;
    
    // Determine animation based on movement
    if (movement.jumping) {
        newAnimation = JUMPING;
    } else if (movement.forward || movement.backward || movement.left || movement.right) {
        newAnimation = movement.running ? RUNNING : WALKING;
    } else {
        // Occasionally switch between idle animations but much less frequently
        if (Math.random() > 0.997) {
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
        fadeOutDuration = 0.1;
        fadeInDuration = 0.1;
    } else if (newAnimation.includes('idle')) {
        // When stopping (transition to idle)
        fadeOutDuration = 0.5;
        fadeInDuration = 0.5;
    } else if (currentAnimation.includes('idle')) {
        // When starting movement from idle
        fadeOutDuration = 0.2;
        fadeInDuration = 0.15;
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
        animations[newAnimation].setEffectiveWeight(0.8);
    } else if (newAnimation === JUMPING) {
        animations[newAnimation].setLoop(THREE.LoopOnce);
        animations[newAnimation].clampWhenFinished = true;
    }
}

export function moveCharacter(delta) {
    if (!currentPlayerModel) return;
    
    let moved = false;
    const speed = movement.running ? runningSpeed : movementSpeed;
    
    // Handle jumping
    if (movement.jumping) {
        movement.jumpProgress += delta / jumpDuration;
        
        if (movement.jumpProgress >= 1) {
            movement.jumping = false;
            movement.jumpProgress = 0;
            updateCharacterAnimation();
        } else {
            const jumpCurve = Math.sin(movement.jumpProgress * Math.PI);
            currentPlayerModel.position.y = jumpCurve * jumpHeight;
            moved = true;
        }
    } else {
        currentPlayerModel.position.y = 0;
    }
    
    // Calculate movement direction
    let moveAngle = currentPlayerModel.rotation.y;
    if (isFirstPerson()) {
        const cameraDirection = new THREE.Vector3();
        getCamera().getWorldDirection(cameraDirection);
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
    if (isFirstPerson()) {
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
    
    // Update camera position
    if (moved) {
        updateCameraPosition(currentPlayerModel);
    }
    
    return moved;
}

export function getAnimationState() {
    if (movement.jumping) {
        return JUMPING;
    } else if (movement.forward || movement.backward || movement.left || movement.right) {
        return movement.running ? RUNNING : WALKING;
    } else {
        return IDLE;
    }
}

export function updatePresence(room) {
    if (!currentPlayerModel) return;
    
    const position = currentPlayerModel.position;
    const rotation = currentPlayerModel.rotation;
    
    room.party.updatePresence({
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { y: rotation.y },
        animation: getAnimationState(),
        timestamp: Date.now(),
        isMoving: movement.forward || movement.backward || movement.left || movement.right,
        isJumping: movement.jumping
    });
}

export function getCurrentPlayerModel() {
    return currentPlayerModel;
}

export function getMixer() {
    return mixer;
}

export function getAnimations() {
    return animations;
}