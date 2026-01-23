document.addEventListener('DOMContentLoaded', function() {
    console.log('Sistema escolar iniciado.');
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Scripts de GitHub cargados correctamente.';
    statusDiv.style.color = 'green';
    statusDiv.style.fontWeight = 'bold';
});