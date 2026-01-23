// 1. CONFIGURACIÓN: PEGA AQUÍ LA URL DE TU SCRIPT DE GOOGLE
const API_URL = "https://script.google.com/macros/s/AKfycbzXBidGNio88OTsnoEGR4Drny89jc-NsYCXFj5yeEWYxpAKON3GVFR4g1M9wCq-s9Q0LQ/exec";

// Variable global para guardar el usuario logueado
let currentUser = null;

// 2. MANEJO DEL LOGIN (ACTUALIZADO)
document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    const btn = this.querySelector('button');
    const msg = document.getElementById('login-msg');

    // Efecto de carga
    btn.disabled = true;
    btn.innerText = "Validando...";
    msg.innerText = "";

    // Petición al servidor (Google Apps Script)
    const response = await sendRequest('login', { user: user, pass: pass });

    if (response.status === 'success') {
        // Login Exitoso
        currentUser = response.data;
        inicializarApp();
    } else {
        // Error (contraseña incorrecta, etc.)
        msg.innerText = response.message;
        btn.disabled = false;
        btn.innerText = "Ingresar";
    }
});

// 3. INICIALIZAR LA APLICACIÓN (NUEVO)
function inicializarApp() {
    // Ocultar pantalla de login y mostrar la app
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';

    // Mostrar nombre y rol en la barra superior
    document.getElementById('user-display-name').innerText = currentUser.name;
    document.getElementById('user-role-badge').innerText = currentUser.role;

    // Filtrar el menú según el rol del usuario
    filtrarMenuPorRol(currentUser.role);
}

// 4. FUNCIÓN PARA FILTRAR MENÚ POR ROLES (NUEVO)
function filtrarMenuPorRol(userRole) {
    // Seleccionamos tanto items simples como menús desplegables
    const menuItems = document.querySelectorAll('.sidebar-menu > .menu-item, .sidebar-menu > .menu-dropdown');
    
    menuItems.forEach(item => {
        const allowedRoles = item.getAttribute('data-roles');
        
        // Si el item no tiene restricción de roles, lo dejamos visible (o puedes ocultarlo por defecto)
        if (!allowedRoles) return; 

        // Si el rol del usuario está en la lista permitida, se muestra. Si no, se oculta.
        if (allowedRoles.includes(userRole)) {
            item.style.display = 'block'; // O 'flex' si usas flexbox en el item
        } else {
            item.style.display = 'none';
        }
    });
}

// 5. FUNCIÓN DE COMUNICACIÓN CON GOOGLE (MANTENER)
async function sendRequest(action, data = {}) {
    const payload = { ...data, action: action };
    
    const options = {
        method: 'POST',
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

// 6. UTILIDADES DE INTERFAZ (MANTENER)

// Manejo de Menús Desplegables
document.querySelectorAll('.dropdown-btn').forEach(button => {
    button.addEventListener('click', () => {
        // Cierra otros menús abiertos (opcional, para efecto acordeón)
        document.querySelectorAll('.dropdown-content').forEach(content => {
            if (content !== button.nextElementSibling) {
                content.classList.remove('show');
            }
        });
        
        const dropdownContent = button.nextElementSibling;
        dropdownContent.classList.toggle('show');
    });
});

function logout() {
    // Recargar la página borra la variable currentUser y reinicia el script
    location.reload();
}

function loadView(viewName) {
    document.getElementById('page-title').innerText = viewName.replace('-', ' ').toUpperCase();
    document.getElementById('content-area').innerHTML = `<h3>Cargando módulo: ${viewName}...</h3>`;
    
    // Aquí agregaremos lógica para cargar contenido real más adelante
}

function testConnection() {
    // Esta función es útil para depurar, la puedes dejar o borrar si ya probaste que funciona
    sendRequest('test_connection').then(res => alert(res.message));
}
