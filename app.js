// IMPORTANTE: PEGA AQUÍ LA URL DE TU SCRIPT DE GOOGLE
const API_URL = "https://script.google.com/macros/s/AKfycbzXBidGNio88OTsnoEGR4Drny89jc-NsYCXFj5yeEWYxpAKON3GVFR4g1M9wCq-s9Q0LQ/exec";

// Manejo del Dropdown del Menú
document.querySelectorAll('.dropdown-btn').forEach(button => {
    button.addEventListener('click', () => {
        const dropdownContent = button.nextElementSibling;
        dropdownContent.classList.toggle('show');
        // Rotar flecha si deseas (opcional con CSS)
    });
});

// Función central para enviar datos a Google Apps Script
async function sendRequest(action, data = {}) {
    // Añadir la acción al objeto de datos
    const payload = { ...data, action: action };
    
    // Usamos 'no-cors' para evitar errores, pero POST requiere text/plain en GAS
    const options = {
        method: 'POST',
        // GAS recibe mejor los datos como string simple en el cuerpo para evitar preflight complex CORS
        body: JSON.stringify(payload) 
    };

    try {
        const response = await fetch(API_URL, options);
        const json = await response.json();
        return json;
    } catch (error) {
        console.error("Error en petición:", error);
        return { status: 'error', message: 'Error de conexión con el servidor.' };
    }
}

// Probar conexión inicial
async function testConnection() {
    alert("Conectando con Google Sheets...");
    const response = await sendRequest('test_connection');
    alert(response.message);
}

// Simulación de Login (Implementaremos la real en el siguiente paso)
document.getElementById('login-form').addEventListener('submit', function(e) {
    e.preventDefault();
    // Por ahora, solo simula el cambio de pantalla
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
});

function logout() {
    location.reload();
}

function loadView(viewName) {
    document.getElementById('page-title').innerText = viewName.replace('-', ' ').toUpperCase();
    document.getElementById('content-area').innerHTML = `<h3>Cargando módulo: ${viewName}...</h3>`;
    // Aquí cargaremos el HTML específico de cada módulo más adelante
}
