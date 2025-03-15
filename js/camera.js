import { getCamera, getScene } from './scene.js';
import { getCurrentPlayerModel } from './character.js';

const cameraFollowDistance = 4;
const cameraHeight = 1.8;
let _isFirstPerson = false;
let controls;

export function setControls(controlsInstance) {
    controls = controlsInstance;
}

export function isFirstPerson() {
    return _isFirstPerson;
}

export function toggleCameraView() {
    const camera = getCamera();
    const currentPlayerModel = getCurrentPlayerModel();
    if (!camera || !currentPlayerModel) return;
    
    _isFirstPerson = !_isFirstPerson;
    
    if (_isFirstPerson) {
        // Switch to first person
        if (controls) controls.enabled = false;
        // Hide player model head
        currentPlayerModel.traverse(node => {
            if (node.isMesh && (node.name.includes('Head') || node.name.includes('head'))) {
                node.visible = false;
            }
        });
    } else {
        // Switch back to third person
        if (controls) controls.enabled = false;
        // Show all parts of the model
        currentPlayerModel.traverse(node => {
            if (node.isMesh) {
                node.visible = true;
            }
        });
    }
}

export function updateCameraPosition(playerModel) {
    const camera = getCamera();
    if (!camera || !playerModel) return;
    
    if (_isFirstPerson && playerModel.userData.fpCameraPosition) {
        // First person - position camera at head
        const fpCameraWorldPosition = new THREE.Vector3();
        playerModel.userData.fpCameraPosition.getWorldPosition(fpCameraWorldPosition);
        camera.position.copy(fpCameraWorldPosition);
        
        // Make camera look in the same direction as the model
        const moveAngle = playerModel.rotation.y;
        camera.lookAt(
            camera.position.x + Math.sin(moveAngle),
            camera.position.y,
            camera.position.z + Math.cos(moveAngle)
        );
    } else {
        // Third person - position camera behind player
        const playerRotation = playerModel.rotation.y;
        
        // Position camera behind player at fixed distance and height
        camera.position.x = playerModel.position.x - Math.sin(playerRotation) * cameraFollowDistance;
        camera.position.y = playerModel.position.y + cameraHeight;
        camera.position.z = playerModel.position.z - Math.cos(playerRotation) * cameraFollowDistance;
        
        // Look at player
        camera.lookAt(
            playerModel.position.x,
            playerModel.position.y + 1, // Look at upper body/head
            playerModel.position.z
        );
    }
}