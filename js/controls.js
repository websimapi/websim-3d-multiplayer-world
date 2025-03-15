import { movement, updateCharacterAnimation, updatePresence } from './character.js';

export function setupMovementControls(room) {
    document.addEventListener('keydown', (event) => onKeyDown(event, room));
    document.addEventListener('keyup', (event) => onKeyUp(event, room));
}

function onKeyDown(event, room) {
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

function onKeyUp(event, room) {
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
        if (!movement.forward && !movement.backward && !movement.left && !movement.right) {
            // Small delay before sending idle state to ensure animation has time to transition
            setTimeout(() => {
                updatePresence(room);
            }, 50);
        }
    }
}