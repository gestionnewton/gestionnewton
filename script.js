// 1. CONFIGURACIÓN
const API_URL = "https://script.google.com/macros/s/AKfycbztyrKgUh-JzUA8HcSBE1hETcgql2Mux_yftoHQGIX5TqnOKsXkUUinyYzaIu7RrfT8QA/exec"; // ¡PON TU URL AQUÍ!
let currentUser = null;
let listaResponsables = []; // Memoria local para filtrar rápido

let seccionesGlobal = [];
let anioActivoID = "";
let anioActivoNombre = ""; // Nueva: Para mostrar el texto en la interfaz (Labels)


// 2. INICIALIZACIÓN (Al cargar la página)
document.addEventListener('DOMContentLoaded', () => {
    configurarMenuResponsivo();
    inicializarMenu();

    // --- NUEVO: PERMITIR ENTER PARA INICIAR SESIÓN ---
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('keypress', function (e) {
            // Si la tecla presionada es ENTER (código 'Enter' o 13)
            if (e.key === 'Enter') {
                e.preventDefault(); // Evita cualquier comportamiento extraño del navegador
                iniciarSesion();    // Ejecuta tu función de login
            }
        });
    }
    // ------------------------------------------------
});



async function cargarConfiguracionInicial() {
    // CAMBIO: Pedimos 'get_secciones' en lugar de solo el año.
    // Esto trae: 1. El Año Activo y 2. Todas las secciones de ese año.
    const respuesta = await sendRequest('get_secciones');

    if (respuesta.status === 'success') {
        // 1. Guardamos el Año (igual que antes)
        if (respuesta.anioActivo) {
            anioActivoID = respuesta.anioActivo.id;
            anioActivoNombre = respuesta.anioActivo.nombre;
        }

        // 2. NUEVO: Guardamos las secciones en memoria INMEDIATAMENTE
        seccionesGlobal = respuesta.data || [];

        console.log(`📌 Sistema sincronizado: ${anioActivoNombre} con ${seccionesGlobal.length} secciones cargadas.`);
        
    } else {
        lanzarNotificacion('error', 'CONFIGURACIÓN', 'No se pudo cargar la configuración inicial.');
    }
}


//3. LOGIN
async function iniciarSesion() {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    const btn = document.querySelector('#login-form .btn-primary');
    const msg = document.getElementById('login-msg');

    // 1. Intentamos leer la firma, si no existe no pasa nada (irá como null al servidor)
    const dispositivoID = localStorage.getItem('newton_device_token');

    if (!user || !pass) { 
        msg.innerText = "Completa los campos."; 
        return; 
    }

    btn.classList.add('btn-active-effect');
    btn.disabled = true;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> VALIDANDO...';
    msg.innerText = "";

    try {
        const response = await sendRequest('login', { 
            user, 
            pass, 
            idDispositivo: dispositivoID 
        });

        if (response && response.status === 'success') {
            // --- BLOQUE DE ÉXITO ---
            sessionStorage.setItem('sessionToken', response.token); 
            currentUser = response.data;

            btn.innerHTML = '<i class="material-icons rotate">settings</i> CARGANDO AÑO...';
            await cargarConfiguracionInicial();
            
            btn.innerHTML = '<i class="material-icons rotate">sync</i> PREPARANDO PANEL...';

            const [resDash, resEv] = await Promise.all([
                sendRequest('get_stats_dashboard', { idAnio: anioActivoID }),
                sendRequest('get_events', { idAnio: anioActivoID })
            ]);

            if (resDash.status === 'success') cacheDashboardData = resDash;
            if (resEv.status === 'success') cacheEventosCalendario = resEv.eventos;

            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-container').style.display = 'flex';
            document.getElementById('user-display-name').innerText = currentUser.name;
            document.getElementById('user-role-badge').innerText = currentUser.role;
            
            if (typeof filtrarMenuPorRol === 'function') {
                filtrarMenuPorRol(currentUser.role);
            }

            loadView('dashboard'); 

        } else {
            // --- BLOQUE DE ERROR / SOLICITUD ---
            const mensajeError = response ? response.message : "Credenciales incorrectas";
            
            // Si es error de dispositivo, mostramos la interfaz de solicitud
            if (response.status === 'error' && mensajeError.includes("DISPOSITIVO")) {
                // MEJORA: Si no hay ID, generamos uno ahora mismo para que la solicitud sea válida
                let idParaSolicitud = dispositivoID;
                if (!idParaSolicitud) {
                    idParaSolicitud = 'NWT-' + Math.random().toString(36).substr(2, 9).toUpperCase();
                    localStorage.setItem('newton_device_token', idParaSolicitud);
                }

                msg.innerHTML = `
                    <div style="color: #991b1b; margin-bottom: 10px; font-weight: bold;">${mensajeError}</div>
                    <div style="padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; text-align: left;">
                        <p style="font-size: 0.8rem; color: #475569; margin-bottom: 10px;">Esta PC no está registrada. Solicita acceso al administrador:</p>
                        <input type="text" id="nombre-pc-solicitud" placeholder="Nombre de esta PC (Ej: Laptop Juan)" 
                               style="width: 100%; margin-bottom: 10px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;">
                        <button type="button" onclick="enviarSolicitudAcceso('${idParaSolicitud}')" 
                                class="btn-primary" style="background: #2563eb; width: 100%; height: 40px;">ENVIAR SOLICITUD</button>
                    </div>
                `;
            } else {
                msg.innerText = mensajeError;
            }

            btn.disabled = false;
            btn.innerHTML = "Ingresar";
            btn.classList.remove('btn-active-effect');
        }
    } catch (error) {
        console.error("Error en login:", error);
        msg.innerText = "Error de conexión con el servidor.";
        btn.disabled = false;
        btn.innerHTML = "Ingresar";
        btn.classList.remove('btn-active-effect');
    }
}

// 4. LOGICA DEL MENÚ Y NAVEGACIÓN
function filtrarMenuPorRol(role) {
    if (!role) return;

    // Seleccionamos TODOS los elementos que tengan data-roles, sin importar su profundidad
    document.querySelectorAll('[data-roles]').forEach(item => {
        const allowed = item.getAttribute('data-roles').split(',');

        if (allowed.includes(role)) {
            // Restauramos el display correcto según el tipo de elemento
            // Los <a> suelen ser 'block' o 'inline-block', los contenedores 'flex'
            if (item.tagName === 'A') {
                item.style.display = 'block'; 
            } else {
                item.style.display = 'flex';
            }
        } else {
            item.style.display = 'none';
        }
    });
}

function logout() { location.reload(); }

//Lógica de Menú Exclusivo
// Configura los dropdowns para que sean exclusivos

function inicializarMenu() {
    const dropdownBtns = document.querySelectorAll('.dropdown-btn');
    dropdownBtns.forEach(btn => {
        btn.onclick = function(e) {
            e.preventDefault();
            const parent = this.parentElement;
            const content = this.nextElementSibling;

            // Cerrar otros dropdowns
            document.querySelectorAll('.menu-dropdown').forEach(item => {
                if (item !== parent) {
                    item.classList.remove('open');
                    const c = item.querySelector('.dropdown-content');
                    if(c) c.classList.remove('show');
                }
            });

            // Abrir/Cerrar actual
            parent.classList.toggle('open');
            content.classList.toggle('show');
            actualizarResaltado(this);
        };
    });
}

function actualizarResaltado(elementoActivo) {
    if (!elementoActivo) return;

    // 1. Limpiar el resaltado de TODO el menú lateral
    document.querySelectorAll('.menu-item, .dropdown-btn, .dropdown-content a').forEach(el => {
        el.classList.remove('active-item');
    });

    // 2. Aplicar el óvalo blanco al elemento que se acaba de presionar
    elementoActivo.classList.add('active-item');

    // 3. Caso especial: Si el clic fue en un submenú (dentro de un dropdown)
    // También resaltamos el botón padre para indicar qué categoría está abierta
    const dropdownContent = elementoActivo.closest('.dropdown-content');
    if (dropdownContent) {
        const padre = dropdownContent.parentElement.querySelector('.dropdown-btn');
        if (padre) {
            padre.classList.add('active-item');
        }
    }
}

function cerrarTodosLosDropdowns() {
    document.querySelectorAll('.menu-dropdown').forEach(item => {
        item.classList.remove('open');
        const c = item.querySelector('.dropdown-content');
        if(c) c.classList.remove('show');
    });
}

function cerrarMenuMovil() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.style.display = 'none';
}




// ENRUTADOR DE VISTAS
function loadView(viewName, element = null) {
    const title = document.getElementById('page-title');
    const contentArea = document.getElementById('content-area');
    
    // Limpiamos el área antes de cargar
    contentArea.innerHTML = "";

    // 1. Cerrar menú en móviles
    if (window.innerWidth <= 1024 && typeof cerrarMenuMovil === 'function') {
        cerrarMenuMovil();
    }

    // 2. Actualizar Título
    if (title) title.innerText = viewName.replace(/-/g, ' ').toUpperCase();

    // 3. Gestionar Resaltado (Active State)
    if (element) {
        actualizarResaltado(element);
    } else {
        const link = document.querySelector(`[onclick*="'${viewName}'"]`);
        if (link) actualizarResaltado(link);
    }

    // 4. Si el botón es de nivel superior, cerramos otros dropdowns
    if (element && element.classList.contains('menu-item')) {
        if (typeof cerrarTodosLosDropdowns === 'function') cerrarTodosLosDropdowns();
    }

    // 5. Cargar la Vista (Limpiando área antes de renderizar)
    if (contentArea) contentArea.innerHTML = "";
    
    const rolesPagos = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];

    switch(viewName) {
        case 'ver-responsables':
        case 'nuevo-responsable':
            renderResponsablesView(); 
            break;
        case 'ver-estudiantes':
        case 'nuevo-estudiante': 
            renderEstudiantesView();
            break;
        case 'anio-academico': 
            renderAniosView(); 
            break;
        case 'config-secciones': 
            renderSeccionesView(); 
            break;
        case 'matricula-masiva': renderMatriculaMasivaView(); break;
        case 'secciones-consultas': renderSeccionesConsultasView(); break;
        case 'traslados': renderTrasladosView(); break;
        case 'conceptos': renderConceptosView(); break;
        case 'descuentos': renderDescuentosView(); break;
        case 'nuevo-recibo': renderNuevoReciboView(); break;
        case 'recibos': 
            if (rolesPagos.includes(currentUser.role)) {
                renderRecibosView(); 
            } else {
                lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tienes permiso para esta sección.');
            }
            break;
        case 'historial-pagos': renderHistorialPagosView(); break;
        case 'egresos': renderEgresosView(); break;
        case 'caja-diaria': renderCajaView(); break;
        case 'dashboard': title.innerText = "Panel de Control"; renderDashboardView();
        // Esta es la función que creamos en el paso anterior
            break;    
        case 'dispositivos': renderDispositivosView(); break;
        case 'reportes_pagos': renderReportesPagosView(); break;     
                
        default:
            if(contentArea) {
                contentArea.innerHTML = `
                <div class="module-header">
                    <h3>Módulo: ${viewName.toUpperCase()}</h3>
                    <p>Próximamente...</p>
                </div>`;
            }
            break;
    }
    if (element) {actualizarItemActivo(element);
    } else {
        // Opcional: buscar el botón de Dashboard en el sidebar y marcarlo como activo manualmente
        const dashBtn = document.querySelector('.menu-item i[content="dashboard"]')?.parentElement;
        if (dashBtn) actualizarItemActivo(dashBtn);
    }
}




// 5. CONEXIÓN CON EL SERVIDOR (Google Apps Script) - CON GUARDIA DE SEGURIDAD
async function sendRequest(action, data = {}) {
    // 1. Extraemos el token del almacenamiento de la sesión
    const token = sessionStorage.getItem('sessionToken');
    
    // 2. Construimos el paquete de datos incluyendo el token
    const payload = { 
        ...data, 
        action: action,
        token: token // El servidor verificará este token antes de procesar nada
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        // 3. EL GUARDIÁN: Si el servidor rechaza el token por expiración
        if (result.status === 'error' && result.message === 'Sesión expirada') {
            logout(); // Función que limpia la pantalla y vuelve al login
            lanzarNotificacion('error', 'SISTEMA', 'SESIÓN', 'Tu sesión ha expirado por inactividad. Ingresa de nuevo.');
            return result;
        }

        return result;

    } catch (error) {
        console.error("Error de conexión:", error);
        return { status: 'error', message: 'Fallo en la comunicación con el servidor.' };
    }
}

// 6. LÓGICA RESPONSIVA (Móvil)
const sidebar = document.querySelector('.sidebar');
const overlay = document.getElementById('sidebar-overlay');

function configurarMenuResponsivo() {
    const menuToggle = document.getElementById('menu-toggle');
    const closeBtn = document.getElementById('close-sidebar-btn');

    if(menuToggle) menuToggle.addEventListener('click', abrirMenuMovil);
    if(closeBtn) closeBtn.addEventListener('click', cerrarMenuMovil);
    if(overlay) overlay.addEventListener('click', cerrarMenuMovil);
}

function abrirMenuMovil() {
    if(sidebar) sidebar.classList.add('active');
    if(overlay) overlay.classList.add('active');
}




// ---------------------------------------------------------
// 7. MÓDULO DE RESPONSABLES (Lógica específica)
// ---------------------------------------------------------

function renderResponsablesView() {
    const content = document.getElementById('content-area');
    
    // Inyectamos el HTML con los IDs corregidos
    content.innerHTML = `
        <div class="module-header" style="margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;">
            <div class="search-group">
                <input type="text" id="search-resp" placeholder="🔍 Buscar Responsable..." onkeyup="filtrarResponsables()">
                <button type="button" class="btn-clear" onclick="limpiarBusquedaResponsables()">
                    <i class="material-icons" style="font-size: 1.2rem;">backspace</i> Limpiar
                </button>
            </div>
            <button class="btn-primary" onclick="abrirModalResponsable()" style="width: auto; height: 50px; padding: 0 25px; display: flex; align-items: center; gap: 8px;">
                <i class="material-icons">group_add</i> Nuevo Responsable
            </button>
        </div>

        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>DNI</th>
                        <th>APELLIDOS Y NOMBRES</th>
                        <th>TELÉFONO</th>
                        <th>ACCIONES</th>
                    </tr>
                </thead>
                <tbody id="tbody-responsables">
                    <tr><td colspan="4" style="text-align:center; padding:30px;">Cargando responsables...</td></tr>
                </tbody>
            </table>
        </div>

        <div id="modal-responsable" class="modal-overlay" style="display: none; position: fixed; top:0; left:0; width:100%; height:100%; z-index: 2000; justify-content: center; align-items: center;">
            <div class="modal-content" style="max-width: 600px;">
                <h3 id="modal-title">Gestión Responsable</h3>
                <form id="form-responsable" onsubmit="guardarResponsable(event)">
                    <input type="hidden" id="resp-id">
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <label>Documento DNI</label>
                            <input type="text" id="resp-dni" placeholder="Ej. 12345678" required>
                        </div>
                        <div>
                            <label>Teléfono Principal</label>
                            <input type="text" id="resp-tel1" placeholder="Ej. 987654321" required>
                        </div>
                    </div>

                    <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <label>Apellido Paterno</label>
                            <input type="text" id="resp-paterno" placeholder="Apellido Paterno" required>
                        </div>
                        <div>
                            <label>Apellido Materno</label>
                            <input type="text" id="resp-materno" placeholder="Apellido Materno" required>
                        </div>
                    </div>

                    <div style="margin-top: 20px;">
                        <label>Nombres Completos</label>
                        <input type="text" id="resp-nombres" placeholder="Nombres del responsable" required style="width: 100%;">
                    </div>

                    <div style="margin-top: 20px;">
                        <label>Teléfono Secundario (Opcional)</label>
                        <input type="text" id="resp-tel2" placeholder="Otro número de contacto" style="width: 100%;">
                    </div>

                    <div style="margin-top: 30px; text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" onclick="document.getElementById('modal-responsable').style.display='none'" class="btn-cancel">CANCELAR</button>
                        <button type="submit" id="btn-save-resp" class="btn-primary" style="width: auto;">GUARDAR RESPONSABLE</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    // Llamar al servidor para llenar la tabla
    cargarDatosResponsables();
}

async function cargarDatosResponsables() {
    const response = await sendRequest('get_responsables');
    if(response.status === 'success') {
        window.listaResponsables = response.data; // Guardamos en variable global
        dibujarTablaResponsables(window.listaResponsables); // Llamamos a la nueva función
    } else {
        document.getElementById('tbody-responsables').innerHTML = `<tr><td colspan="4">Error: ${response.message}</td></tr>`;
    }
}

function dibujarTablaResponsables(datos) {
    const tbody = document.getElementById('tbody-responsables');
    if (!tbody) return;
    tbody.innerHTML = '';

    datos.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 15px;">${r.dni}</td>
            <td style="padding: 15px;"><strong>${r.paterno} ${r.materno}</strong>, ${r.nombres}</td>
            <td style="padding: 15px;">${r.tel1}</td>
            <td style="padding: 15px;">
                <div class="action-buttons">
                    <button class="btn-icon view" onclick="verResponsable('${r.id}')" title="Ver Detalle">
                        <i class="material-icons">visibility</i>
                    </button>
                    <button class="btn-icon edit" onclick="editarResponsable('${r.id}')" title="Editar">
                        <i class="material-icons">edit</i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filtrarResponsables() {
    const texto = document.getElementById('search-resp').value.toLowerCase();
    // Usamos window.listaResponsables para asegurar acceso global
    const filtrados = window.listaResponsables.filter(r => 
        r.dni.toString().includes(texto) || 
        r.paterno.toLowerCase().includes(texto) || 
        r.materno.toLowerCase().includes(texto) || 
        r.nombres.toLowerCase().includes(texto)
    );
    // Cambiado de dibujarTabla a dibujarTablaResponsables
    dibujarTablaResponsables(filtrados); 
}

function abrirModalResponsable() {
    configurarModoFormulario('form-responsable', 'btn-save-resp', false);
    document.getElementById('form-responsable').reset();
    document.getElementById('modal-title').innerText = "Nuevo Responsable";
    document.getElementById('resp-id').value = "";
    document.getElementById('resp-dni').value = "";
    document.getElementById('resp-paterno').value = "";
    document.getElementById('resp-materno').value = "";
    document.getElementById('resp-nombres').value = "";
    document.getElementById('resp-tel1').value = "";
    document.getElementById('resp-tel2').value = "";
    document.getElementById('modal-title').innerText = "Nuevo Responsable";
    document.getElementById('modal-responsable').style.display = 'flex';
}

function editarResponsable(id) {
    // 1. Habilitamos el formulario
    configurarModoFormulario('form-responsable', 'btn-save-resp', false);
    document.getElementById('modal-title').innerText = "Editar Responsable";
    
    // 2. Buscamos el dato en la lista global (Asegúrate que se llame listaResponsables)
    const r = window.listaResponsables.find(item => item.id === id);
    if(!r) {
        console.error("No se encontró el responsable con ID:", id);
        return;
    }
    
    // 3. Llenamos los campos del modal
    document.getElementById('resp-id').value = r.id || "";
    document.getElementById('resp-dni').value = r.dni || "";
    document.getElementById('resp-tel1').value = r.tel1 || "";
    document.getElementById('resp-paterno').value = r.paterno || "";
    document.getElementById('resp-materno').value = r.materno || "";
    document.getElementById('resp-nombres').value = r.nombres || "";
    document.getElementById('resp-tel2').value = r.tel2 || "";
    
    // 4. Mostramos el modal
    document.getElementById('modal-responsable').style.display = 'flex';
}

async function guardarResponsable(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML; // Guardamos "+ Guardar"
    
    // Bloqueamos y ponemos a cargar
    btn.innerHTML = '<i class="material-icons rotate" style="font-size:1.2rem; vertical-align:middle;">sync</i> PROCESANDO...';
    btn.disabled = true;

    const identidad = `${document.getElementById('resp-paterno').value} ${document.getElementById('resp-nombres').value}`;
    
    const datos = {
        id: document.getElementById('resp-id').value,
        dni: document.getElementById('resp-dni').value,
        tel1: document.getElementById('resp-tel1').value,
        paterno: document.getElementById('resp-paterno').value,
        materno: document.getElementById('resp-materno').value,
        nombres: document.getElementById('resp-nombres').value,
        tel2: document.getElementById('resp-tel2').value
    };

    try {
        const response = await sendRequest('save_responsable', datos);
        if (response.status === 'success') {
            document.getElementById('modal-responsable').style.display = 'none';
            lanzarNotificacion('success', 'RESPONSABLES', identidad);
            cargarDatosResponsables();
        } else {
            lanzarNotificacion('error', 'RESPONSABLES', identidad, response.message);
        }
    } catch (err) {
        lanzarNotificacion('error', 'RESPONSABLES', identidad, "Error de conexión con el servidor.");
    } finally {
        // ESTO FALTABA: Restaurar el botón pase lo que pase
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}



////////////////////
// --- MÓDULO DE ESTUDIANTES ---
// --- 1. FUNCIÓN PARA CARGAR LOS DATOS DESDE EL SERVIDOR ---
async function cargarEstudiantes() {
    const tbody = document.getElementById('tbody-estudiantes');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px;">Buscando datos...</td></tr>';

    try {
        // 1. Nos aseguramos de tener la lista de responsables primero
        if (!window.listaResponsables || window.listaResponsables.length === 0) {
            const respData = await sendRequest('get_responsables');
            window.listaResponsables = respData.data || [];
        }

        // 2. Cargamos los estudiantes
        const response = await sendRequest('get_estudiantes');
        
        if (response && response.status === 'success') {
            window.listaEstudiantes = response.data;
            dibujarTablaEstudiantes(response.data);
        } else {
            tbody.innerHTML = `<tr><td colspan="4">Error: ${response.message}</td></tr>`;
        }
    } catch (error) {
        console.error("Error en carga:", error);
    }
}

// --- 2. FUNCIÓN PARA DIBUJAR LA TABLA EN EL HTML ---
function dibujarTablaEstudiantes(datos) {
    const tbody = document.getElementById('tbody-estudiantes');
    if (!tbody) return;
    tbody.innerHTML = '';

    datos.forEach(est => {
        const responsable = window.listaResponsables.find(r => r.id === est.idResp1);
        const nombreResp = responsable ? `${responsable.paterno} ${responsable.nombres}` : est.idResp1;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 15px;">${est.dni}</td>
            <td style="padding: 15px;"><strong>${est.paterno} ${est.materno}</strong>, ${est.nombres}</td>
            <td style="padding: 15px; color: var(--text-muted);">${nombreResp}</td>
            <td style="padding: 15px;">
                <div class="action-buttons">
                    <button class="btn-icon view" onclick="verEstudiante('${est.id}')" title="Ver Detalle">
                        <i class="material-icons">visibility</i>
                    </button>
                    <button class="btn-icon edit" onclick="editarEstudiante('${est.id}')" title="Editar">
                        <i class="material-icons">edit</i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 3. FUNCIÓN PARA RENDERIZAR LA VISTA (LLAMADA DESDE LOADVIEW) ---
function renderEstudiantesView() {
    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header" style="margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;">
            
            <div class="search-group">
                <input type="text" id="search-est" placeholder="🔍 Buscar Estudiante..." onkeyup="filtrarEstudiantes()">
                <button type="button" class="btn-clear" onclick="limpiarBusquedaEstudiantes()">
                    <i class="material-icons" style="font-size: 1.2rem;">backspace</i> Limpiar
                </button>
            </div>

            <button class="btn-primary" onclick="abrirModalEstudiante()" style="width: auto; height: 50px; padding: 0 25px; display: flex; align-items: center; gap: 8px;">
                <i class="material-icons">person_add</i> Nuevo Estudiante
            </button>
        </div>

        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>DNI</th>
                        <th>APELLIDOS Y NOMBRES</th>
                        <th>RESPONSABLE PRINCIPAL</th>
                        <th>ACCIONES</th>
                    </tr>
                </thead>
                <tbody id="tbody-estudiantes">
                    <tr><td colspan="4" style="text-align:center; padding:30px;">Cargando estudiantes...</td></tr>
                </tbody>
            </table>
        </div>

        <div id="modal-estudiante" class="modal-overlay">
            <div class="modal-content">
                <h3 id="modal-title-est">Ficha del Estudiante</h3>
                
                <form id="form-estudiante" onsubmit="procesarGuardadoEstudiante(event)">
                    <input type="hidden" id="est-id">
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
                        <div>
                            <label>Apellido Paterno</label>
                            <input type="text" id="est-paterno" placeholder="Ej. Pérez" required>
                        </div>
                        <div>
                            <label>Apellido Materno</label>
                            <input type="text" id="est-materno" placeholder="Ej. García" required>
                        </div>
                        <div>
                            <label>Nombres Completos</label>
                            <input type="text" id="est-nombres" placeholder="Ej. Juan Carlos" required>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 20px;">
                        <div>
                            <label>Documento DNI</label>
                            <input type="text" id="est-dni" placeholder="8 dígitos" required>
                        </div>
                        <div>
                            <label>Género / Sexo</label>
                            <select id="est-sexo" required class="custom-select">
                                <option value="">Seleccione...</option>
                                <option value="Masculino">Masculino</option>
                                <option value="Femenino">Femenino</option>
                            </select>
                        </div>
                        <div>
                            <label>Fecha de Nacimiento</label>
                            <input type="date" id="est-nacimiento" required>
                        </div>
                    </div>

                    <div style="margin-top: 20px;">
                        <label>Dirección Domiciliaria</label>
                        <input type="text" id="est-direccion" placeholder="Calle, Av. o Jr. con número" required style="width:100%;">
                    </div>

                    <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="position: relative;">
                            <label>Responsable Principal *</label>
                            <input type="text" id="search-resp1" placeholder="Buscar por DNI o Nombre..." onkeyup="buscarResponsableEnModal(1)" autocomplete="off">
                            <input type="hidden" id="est-id-resp1"> 
                            <div id="results-resp1" class="search-results-box"></div> 
                        </div>

                        <div>
                            <label>Parentesco</label>
                            <select id="est-parent1" class="custom-select">
                                <option value="PADRE">PADRE</option>
                                <option value="MADRE">MADRE</option>
                                <option value="APODERADO">APODERADO/A</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="position: relative;">
                            <label>Responsable 2 (Opcional)</label>
                            <input type="text" id="search-resp2" placeholder="Buscar por DNI o Nombre..." onkeyup="buscarResponsableEnModal(2)" autocomplete="off">
                            <input type="hidden" id="est-id-resp2"> 
                            <div id="results-resp2" class="search-results-box"></div> 
                        </div>

                        <div>
                            <label>Parentesco 2</label>
                            <select id="est-parent2" class="custom-select">
                                <option value="">Ninguno</option>
                                <option value="PADRE">PADRE</option>
                                <option value="MADRE">MADRE</option>
                                <option value="APODERADO">APODERADO/A</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-top: 40px; text-align: right; display: flex; gap: 15px; justify-content: flex-end;">
                        <button type="button" onclick="cerrarModalEstudiante()" class="btn-cancel">CANCELAR</button>
                        <button type="submit" id="btn-save-est" class="btn-primary" style="width: auto;">GUARDAR ESTUDIANTE</button>
                    </div>
                </form>
            </div>
        </div>

        <div id="modal-success" class="modal-overlay" style="display: none; position: fixed; top:0; left:0; width:100%; height:100%; z-index: 3000; justify-content: center; align-items: center;">
            <div class="modal-content" style="max-width: 400px; text-align: center; padding: 40px;">
                <i class="material-icons" style="font-size: 70px; color: #10b981; margin-bottom: 20px;">check_circle</i>
                <h3 style="margin-bottom: 10px;">¡Guardado Exitoso!</h3>
                <p style="color: var(--text-muted); margin-bottom: 25px;">Los datos han sido procesados correctamente.</p>
                <button class="btn-primary" onclick="cerrarExito()">ACEPTAR</button>
            </div>
        </div>
    `;
    
    // Una vez inyectado el HTML, llamamos a la función de carga
    cargarEstudiantes();
}

// Función para obtener el ID real desde el datalist
function vincularID(num) {
    const input = document.getElementById(`est-resp${num}-search`);
    const val = input.value;
    const option = document.querySelector(`#list-resp option[value='${val}']`);
    if (option) {
        document.getElementById(`est-resp${num}-id`).value = option.getAttribute('data-id');
    } else {
        document.getElementById(`est-resp${num}-id`).value = "";
    }
}

async function procesarGuardarEstudiante(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-est');
    
    // 1. Evitar doble envío
    if(btn.disabled) return;
    
    // 2. Animación de carga
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Guardando...`;

    // 3. Recolectar datos
    const datos = {
        paterno: document.getElementById('est-paterno').value,
        materno: document.getElementById('est-materno').value,
        nombres: document.getElementById('est-nombres').value,
        dni: document.getElementById('est-dni').value,
        sexo: document.getElementById('est-sexo').value,
        nacimiento: document.getElementById('est-nacimiento').value,
        direccion: document.getElementById('est-direccion').value,
        resp1_id: document.getElementById('est-resp1-id').value,
        parentesco1: document.getElementById('est-parentesco1').value,
        resp2_id: document.getElementById('est-resp2-id').value,
        parentesco2: document.getElementById('est-parentesco2').value
    };

    // Validación extra para responsables obligatorios
    if(!datos.resp1_id) {
        alert("Debe seleccionar un responsable válido de la lista.");
        btn.disabled = false;
        btn.innerHTML = originalText;
        return;
    }

    const response = await sendRequest('save_estudiante', datos);

    if(response.status === 'success') {
        mostrarModalExito("¡Registro Exitoso!", "El estudiante ha sido guardado correctamente en el sistema.");
    } else {
        alert("Error: " + response.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Ventana Flotante Personalizada
function mostrarModalExito(titulo, mensaje) {
    const modalHtml = `
        <div id="modal-exito" class="modal-overlay" style="display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center;">
            <div class="modal-content" style="background:white; padding:40px; border-radius:24px; text-align:center; max-width:400px; box-shadow:0 20px 50px rgba(0,0,0,0.2);">
                <div style="background:#dcfce7; color:#166534; width:80px; height:80px; border-radius:50%; display:flex; justify-content:center; align-items:center; margin: 0 auto 20px;">
                    <i class="material-icons" style="font-size: 50px;">check_circle</i>
                </div>
                <h2 style="font-weight:800; color:var(--sidebar-dark); margin-bottom:10px;">${titulo}</h2>
                <p style="color:var(--text-muted); margin-bottom:30px; font-size:1.1rem;">${mensaje}</p>
                <button onclick="cerrarExito()" class="btn-primary" style="width:100%; padding:16px;">ACEPTAR</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function cerrarExito() {
    const m = document.getElementById('modal-exito');
    if(m) m.remove();
    loadView('ver-estudiantes'); // Redirigir a la tabla
}


//////////////////////////////////////



// --- LÓGICA DEL BUSCADOR DINÁMICO ---
async function buscarResponsableEnModal(num) {
    const input = document.getElementById(`search-resp${num}`);
    const resultsDiv = document.getElementById(`results-resp${num}`);
    const hiddenId = document.getElementById(`est-id-resp${num}`);
    
    if (!input || !resultsDiv) return;

    const query = input.value.toLowerCase().trim();

    if (query.length < 2) { 
        resultsDiv.style.display = 'none'; 
        return; 
    }

    // CARGA DE SEGURIDAD: Si la lista está vacía, la traemos
    if (!window.listaResponsables || window.listaResponsables.length === 0) {
        const resp = await sendRequest('get_responsables');
        if (resp && resp.data) {
            window.listaResponsables = resp.data;
        }
    }

    // FILTRADO
    const filtrados = window.listaResponsables.filter(r => {
        const dni = r.dni ? r.dni.toString() : "";
        const nombre = `${r.paterno} ${r.materno} ${r.nombres}`.toLowerCase();
        return dni.includes(query) || nombre.includes(query);
    });

    resultsDiv.innerHTML = '';

    if (filtrados.length > 0) {
        resultsDiv.style.display = 'block';
        filtrados.slice(0, 5).forEach(r => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<strong>${r.dni}</strong> - ${r.paterno} ${r.nombres}`;
            div.onclick = () => {
                input.value = `${r.paterno} ${r.nombres}`;
                hiddenId.value = r.id; // Guardamos el ID real
                resultsDiv.style.display = 'none';
                input.style.borderColor = '#10b981'; // Color verde de éxito
            };
            resultsDiv.appendChild(div);
        });
    } else {
        resultsDiv.style.display = 'none';
    }
}



function cerrarExito() { document.getElementById('modal-success').style.display = 'none'; }
function cerrarModalEstudiante() { document.getElementById('modal-estudiante').style.display = 'none'; }
function abrirModalEstudiante() { 
    configurarModoFormulario('form-estudiante', 'btn-save-est', false); // HABILITAR
    document.getElementById('form-estudiante').reset();
    document.getElementById('modal-title-est').innerText = "Nuevo Estudiante";
    document.getElementById('est-id').value = "";
    document.getElementById('est-id-resp1').value = "";
    document.getElementById('est-id-resp2').value = "";
    // --- LÍNEAS PARA RESETEAR EL BOTÓN ---
    const btn = document.getElementById('btn-save-est');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = "GUARDAR ESTUDIANTE"; // Regresa al texto original
    }
    // -------------------------------------
    document.getElementById('modal-estudiante').style.display = 'flex'; 
}


// --- FUNCIÓN PARA FILTRAR (Buscador superior) ---
function filtrarEstudiantes() {
    const texto = document.getElementById('search-est').value.toLowerCase();
    const filtrados = window.listaEstudiantes.filter(est => 
        est.dni.toString().includes(texto) || 
        (est.paterno + " " + est.materno + " " + est.nombres).toLowerCase().includes(texto)
    );
    dibujarTablaEstudiantes(filtrados);
}




/**
 * Busca responsables en la lista global y muestra los resultados.
 * @param {number} num - Identificador del buscador (1 para Responsable 1, 2 para Responsable 2)
 */
async function buscarResponsableEnModal(num) {
    const input = document.getElementById(`search-resp${num}`);
    const resultsDiv = document.getElementById(`results-resp${num}`);
    const hiddenId = document.getElementById(`est-id-resp${num}`);
    const query = input.value.toLowerCase().trim();

    // Si el texto es muy corto, ocultamos la caja de resultados
    if (query.length < 2) { 
        resultsDiv.style.display = 'none'; 
        hiddenId.value = ""; // Limpiamos el ID si el usuario borra el texto
        return; 
    }

    // Si la lista de responsables no está cargada, la solicitamos una vez
    if (!window.listaResponsables || window.listaResponsables.length === 0) {
        const resp = await sendRequest('get_responsables');
        window.listaResponsables = resp.data || [];
    }

    // Filtramos por DNI o por Nombre Completo
    const filtrados = window.listaResponsables.filter(r => 
        r.dni.toString().includes(query) || 
        `${r.paterno} ${r.materno} ${r.nombres}`.toLowerCase().includes(query)
    );

    // Limpiamos resultados anteriores
    resultsDiv.innerHTML = '';

    if (filtrados.length > 0) {
        resultsDiv.style.display = 'block';
        
        filtrados.slice(0, 5).forEach(r => { // Mostramos máximo 5 sugerencias
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<strong>${r.dni}</strong> - ${r.paterno} ${r.nombres}`;
            
            // Acción al hacer clic en una sugerencia
            div.onclick = () => {
                input.value = `${r.paterno} ${r.nombres}`;
                hiddenId.value = r.id; // Guardamos el ID en el campo oculto
                resultsDiv.style.display = 'none';
                input.style.borderColor = '#10b981'; // Cambio visual a verde (éxito)
            };
            resultsDiv.appendChild(div);
        });
    } else {
        resultsDiv.style.display = 'none';
    }
}


async function procesarGuardadoEstudiante(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-save-est');
    const originalText = btn.innerHTML;

    // Validación de Responsable (Evita el error inmediato en el servidor)
    const idResp1 = document.getElementById('est-id-resp1').value;
    if (!idResp1) {
        lanzarNotificacion('error', 'ESTUDIANTES', "DATOS INCOMPLETOS", "Debes seleccionar un Responsable Principal de la lista de búsqueda.");
        return;
    }

    btn.innerHTML = '<i class="material-icons rotate" style="font-size:1.2rem; vertical-align:middle;">sync</i> GUARDANDO...';
    btn.disabled = true;

    const identidad = `${document.getElementById('est-paterno').value} ${document.getElementById('est-nombres').value}`;

    const datos = {
        id: document.getElementById('est-id').value,
        dni: document.getElementById('est-dni').value,
        paterno: document.getElementById('est-paterno').value,
        materno: document.getElementById('est-materno').value,
        nombres: document.getElementById('est-nombres').value,
        sexo: document.getElementById('est-sexo').value,
        nacimiento: document.getElementById('est-nacimiento').value,
        direccion: document.getElementById('est-direccion').value,
        idResp1: idResp1,
        parentesco1: document.getElementById('est-parent1').value,
        idResp2: document.getElementById('est-id-resp2').value,
        parentesco2: document.getElementById('est-parent2').value
    };

    try {
        const response = await sendRequest('save_estudiante', datos);
        if (response.status === 'success') {
            cerrarModalEstudiante();
            lanzarNotificacion('success', 'ESTUDIANTES', identidad);
            cargarEstudiantes();
        } else {
            lanzarNotificacion('error', 'ESTUDIANTES', identidad, response.message);
        }
    } catch (err) {
        lanzarNotificacion('error', 'ESTUDIANTES', identidad, "Error de red o sesión expirada.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}



// Función para cerrar el mensaje de éxito
function cerrarExito() {
    document.getElementById('modal-success').style.display = 'none';
}





/**
 * Prepara el modal con los datos del estudiante para su edición.
 * @param {string} id - ID del estudiante a editar.
 */
function editarEstudiante(id) {
    // 1. Nos aseguramos de que el formulario esté habilitado
    configurarModoFormulario('form-estudiante', 'btn-save-est', false);
    document.getElementById('modal-title-est').innerText = "Editar Estudiante";
    
    // 1. Buscar al estudiante en la lista global
    const est = window.listaEstudiantes.find(e => e.id === id);
    if (!est) {
        console.error("Estudiante no encontrado con ID:", id);
        return;
    }

    // --- LÍNEAS PARA RESETEAR EL BOTÓN ---
    const btn = document.getElementById('btn-save-est');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = "GUARDAR ESTUDIANTE";
    }
    // -------------------------------------

    // 2. Cambiar el título del modal para indicar edición
    const modalTitle = document.getElementById('modal-title-est');
    if (modalTitle) modalTitle.innerText = "Editar Estudiante";

    // 3. Llenar los campos básicos de identidad
    document.getElementById('est-id').value = est.id;
    document.getElementById('est-paterno').value = est.paterno;
    document.getElementById('est-materno').value = est.materno;
    document.getElementById('est-nombres').value = est.nombres;
    document.getElementById('est-dni').value = est.dni;
    document.getElementById('est-sexo').value = est.sexo;
    document.getElementById('est-direccion').value = est.direccion;

    // 4. Formatear la fecha para el input date (YYYY-MM-DD)
    if (est.nacimiento) {
        const fecha = new Date(est.nacimiento);
        const yyyy = fecha.getFullYear();
        const mm = String(fecha.getMonth() + 1).padStart(2, '0');
        const dd = String(fecha.getDate()).padStart(2, '0');
        document.getElementById('est-nacimiento').value = `${yyyy}-${mm}-${dd}`;
    }

    // 5. Cargar Responsable 1
    document.getElementById('est-id-resp1').value = est.idResp1 || "";
    // Aseguramos que el valor del select coincida exactamente con la opción (ej: "PADRE")
    document.getElementById('est-parent1').value = est.parentesco1 || "PADRE";
    
    // Buscamos el nombre del responsable para mostrarlo en el buscador visual
    const resp1 = window.listaResponsables.find(r => r.id === est.idResp1);
    const searchInput1 = document.getElementById('search-resp1');
    if (resp1 && searchInput1) {
        searchInput1.value = `${resp1.paterno} ${resp1.nombres}`;
        searchInput1.style.borderColor = '#10b981'; // Indica selección válida
    }

    // 6. Cargar Responsable 2
    const searchInput2 = document.getElementById('search-resp2');
    if (est.idResp2) {
        document.getElementById('est-id-resp2').value = est.idResp2;
        document.getElementById('est-parent2').value = est.parentesco2 || "";
        
        const resp2 = window.listaResponsables.find(r => r.id === est.idResp2);
        if (resp2 && searchInput2) {
            searchInput2.value = `${resp2.paterno} ${resp2.nombres}`;
            searchInput2.style.borderColor = '#10b981';
        }
    } else {
        // Limpiar si no tiene segundo responsable
        document.getElementById('est-id-resp2').value = "";
        document.getElementById('est-parent2').value = "";
        if (searchInput2) {
            searchInput2.value = "";
            searchInput2.style.borderColor = '#e5e7eb';
        }
    }

    // 7. Mostrar el modal
    document.getElementById('modal-estudiante').style.display = 'flex';
}

///////botón limpiar cuadro de búsqueda
function limpiarBusquedaResponsables() {
    const input = document.getElementById('search-resp');
    input.value = ''; // Borra el texto
    filtrarResponsables(); // Resetea la tabla mostrando todos los datos
    input.focus(); // Devuelve el cursor al buscador
}


function limpiarBusquedaEstudiantes() {
    const input = document.getElementById('search-est');
    if (input) {
        input.value = ''; // Borra el texto
        filtrarEstudiantes(); // Refresca la tabla para mostrar todos
        input.focus(); // Devuelve el foco al cuadro
    }
}


// --- VER DETALLE ESTUDIANTE ---
function verEstudiante(id) {
    // 1. Cargamos los datos y abrimos el modal usando la función de edición
    editarEstudiante(id); 
    
    // 2. INMEDIATAMENTE DESPUÉS, bloqueamos todo
    configurarModoFormulario('form-estudiante', 'btn-save-est', true); 
    
    // 3. Cambiamos el título
    document.getElementById('modal-title-est').innerText = "Ficha del Estudiante (Vista)";
}

// --- VER DETALLE RESPONSABLE ---
function verResponsable(id) {
    // 1. Cargamos datos con la función de editar
    editarResponsable(id); 
    // 2. Bloqueamos el formulario inmediatamente
    configurarModoFormulario('form-responsable', 'btn-save-resp', true);
    document.getElementById('modal-title').innerText = "Ficha del Responsable (Vista)";
}

// --- IMPORTANTE: Resetear el modo lectura al abrir para editar o nuevo ---
// Debes añadir estas líneas a tus funciones abrirModal... y editar...
function habilitarCampos(selectorModal, idBoton) {
    const fields = document.querySelectorAll(`${selectorModal} input, ${selectorModal} select`);
    fields.forEach(f => f.disabled = false);
    const btn = document.getElementById(idBoton);
    if(btn) btn.style.display = 'block';
}


/**
 * Alterna el estado del formulario entre Lectura y Edición
 * @param {string} formId - ID del formulario
 * @param {string} btnSaveId - ID del botón de guardar
 * @param {boolean} readOnly - true para bloquear, false para habilitar
 */
function configurarModoFormulario(formId, btnSaveId, readOnly) {
    const form = document.getElementById(formId);
    const btnSave = document.getElementById(btnSaveId);
    
    if (!form) return;

    // BLOQUEAMOS solo campos de entrada de datos
    const campos = form.querySelectorAll('input, select, textarea');
    campos.forEach(el => el.disabled = readOnly);
    
    // El botón de guardar se oculta o se muestra
    if (btnSave) {
        btnSave.style.display = readOnly ? 'none' : 'block';
    }
}



/**
 * Notificación Global del Sistema
 * @param {string} tipo - 'success' | 'error'
 * @param {string} seccion - Ej: 'ESTUDIANTES'
 * @param {string} identidad - Nombre del sujeto
 * @param {string} mensajeExtra - Detalles del error o éxito
 */

function lanzarNotificacion(tipo, seccion, identidad, mensajeExtra = "") {
    let overlay = document.getElementById('system-notify');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'system-notify';
        overlay.className = 'notify-overlay';
        document.body.appendChild(overlay);
    }

    // --- LÓGICA DE CARGA (LOADING) ---
    if (tipo === 'loading') {
        overlay.innerHTML = `
            <div class="notify-card loading">
                <div class="notify-spinner"></div>
                <h3 style="color: var(--primary-blue); margin-bottom: 5px;">Procesando...</h3>
                <p style="margin-bottom: 10px; font-size: 0.9rem;">Sección: <strong>${seccion}</strong></p>
                <div class="loading-text">${identidad}</div> 
                ${mensajeExtra ? `<div style="font-size: 0.85rem; color: #64748b; margin-top: 10px;">${mensajeExtra}</div>` : ''}
            </div>
        `;
        overlay.style.display = 'flex';
        return; // Salimos aquí, no pintamos botones
    }

    // --- LÓGICA ORIGINAL (ÉXITO / ERROR / INFO) ---
    const esExito = tipo === 'success';
    const esInfo = tipo === 'info'; // Por si usas notificaciones informativas simples
    
    let icono = 'check_circle';
    let titulo = '¡Guardado con Éxito!';
    let claseCard = 'success';

    if (esExito) {
        icono = 'check_circle';
        titulo = '¡Operación Exitosa!';
        claseCard = 'success';
    } else if (esInfo) {
        icono = 'info';
        titulo = 'Información';
        claseCard = 'loading'; // Reusamos el borde azul o creas uno 'info'
        document.querySelector('.notify-card')?.style.setProperty('border-top-color', 'var(--accent-cyan)');
    } else {
        icono = 'report_problem';
        titulo = 'Error al Procesar';
        claseCard = 'error';
    }

    overlay.innerHTML = `
        <div class="notify-card ${claseCard}">
            <i class="material-icons" style="color: ${esExito ? '#10b981' : (esInfo ? '#06b6d4' : '#ef4444')}">${icono}</i>
            <h3>${titulo}</h3>
            <p>Sección: <strong>${seccion}</strong></p>
            <span class="identity-text">${identidad}</span>
            ${!esExito && !esInfo ? `<div class="error-msg">Motivo: ${mensajeExtra}</div>` : ''}
            
            <button class="btn-primary" onclick="cerrarNotify()" style="margin-top: 20px; width: 100%; background-color: ${esExito ? 'var(--primary-blue)' : '#334155'};">
                ${esExito ? 'ENTENDIDO' : 'CERRAR'}
            </button>
        </div>
    `;

    overlay.style.display = 'flex';
}

// Función para cerrar manualmente (si no la tenías)
function cerrarNotify() {
    const overlay = document.getElementById('system-notify');
    
    // Si no existe el overlay, no hacemos nada
    if (!overlay) return;

    // Buscamos la tarjeta interna para animarla
    const card = overlay.querySelector('.notify-card');

    if (card) {
        // 1. Activamos la animación de salida (Scale down + Fade out)
        card.classList.add('closing');

        // 2. Esperamos 300ms (tiempo suficiente para la animación de 0.2s)
        setTimeout(() => {
            overlay.style.display = 'none';
            // Importante: Quitamos la clase 'closing' para que la próxima vez 
            // que se abra, entre limpia con la animación de entrada.
            card.classList.remove('closing'); 
        }, 300);
    } else {
        // Fallback de seguridad: si no encuentra la tarjeta, cierra de golpe
        overlay.style.display = 'none';
    }
}


function cerrarNotify() {
    document.getElementById('system-notify').style.display = 'none';
}



// --- MÓDULO: AÑO ACADÉMICO ---------------------------------------------
function renderAniosView() {
    // SEGURIDAD FRONTEND: Verificar rol antes de renderizar
    if (currentUser.role !== 'ADMINISTRADOR') {
        lanzarNotificacion('error', 'ACCESO', 'DENEGADO', 'No tienes permisos para configurar el Año Académico.');
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <div>
                <h2 style="font-size: 2rem; color: var(--sidebar-dark);">Configuración de Año Académico</h2>
                <p style="color: var(--text-muted);">Gestione los periodos escolares y defina cuál está activo.</p>
            </div>
            <button class="btn-primary" style="width: auto;" onclick="abrirModalAnio()">
                <i class="material-icons" style="vertical-align: middle;">add</i> NUEVO AÑO
            </button>
        </div>

        <div class="table-container">
            <table class="data-table" id="tabla-anios">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>NOMBRE DEL PERIODO</th>
                        <th>ESTADO</th>
                        <th>ACCIONES</th>
                    </tr>
                </thead>
                <tbody id="body-anios">
                    <tr><td colspan="4" style="text-align:center;">Cargando periodos...</td></tr>
                </tbody>
            </table>
        </div>

        <div id="modal-anio" class="modal-overlay">
            <div class="modal-content" style="max-width: 500px;">
                <h3 id="modal-title-anio">Configurar Año</h3>
                <form id="form-anio" onsubmit="procesarGuardadoAnio(event)">
                    <input type="hidden" id="anio-id">
                    
                    <div style="margin-bottom: 20px;">
                        <label>Nombre del Año Académico</label>
                        <input type="text" id="anio-nombre" placeholder="Ej: Año Escolar 2026" required style="width: 100%;">
                    </div>

                    <div style="margin-bottom: 30px;">
                        <label>Estado del Periodo</label>
                        <select id="anio-estado" class="custom-select" required>
                            <option value="ACTIVO">ACTIVO (Solo uno a la vez)</option>
                            <option value="CERRADO">CERRADO</option>
                        </select>
                    </div>

                    <div style="text-align: right; display: flex; gap: 15px; justify-content: flex-end;">
                        <button type="button" onclick="cerrarModalAnio()" class="btn-cancel">CANCELAR</button>
                        <button type="submit" id="btn-save-anio" class="btn-primary" style="width: auto;">GUARDAR CONFIGURACIÓN</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    cargarAnios();
}

async function cargarAnios() {
    const response = await sendRequest('get_anios');
    const tbody = document.getElementById('body-anios');
    
    if (response.status === 'success') {
        if (response.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay años registrados.</td></tr>';
            return;
        }

        tbody.innerHTML = response.data.map(anio => `
            <tr>
                <td>${anio.id}</td>
                <td style="font-weight: 700;">${anio.nombre}</td>
                <td>
                    <span class="badge" style="background: ${anio.estado === 'ACTIVO' ? '#dcfce7' : '#fee2e2'}; 
                                              color: ${anio.estado === 'ACTIVO' ? '#166534' : '#991b1b'};">
                        ${anio.estado}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon edit" onclick="editarAnio('${anio.id}', '${anio.nombre}', '${anio.estado}')" title="Editar">
                            <i class="material-icons">edit</i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }
}



async function procesarGuardadoAnio(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-save-anio');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';
    btn.disabled = true;

    const datos = {
        id: document.getElementById('anio-id').value,
        nombre: document.getElementById('anio-nombre').value,
        estado: document.getElementById('anio-estado').value
    };

    try {
        const response = await sendRequest('save_anio', datos);
        if (response.status === 'success') {
            cerrarModalAnio();
            lanzarNotificacion('success', 'CONFIGURACIÓN', datos.nombre);
            cargarAnios();
        } else {
            lanzarNotificacion('error', 'CONFIGURACIÓN', 'Error', response.message);
        }
    } catch (error) {
        lanzarNotificacion('error', 'CONFIGURACIÓN', 'Error de Red');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Funciones de apoyo para el modal
function abrirModalAnio() {
    document.getElementById('form-anio').reset();
    document.getElementById('anio-id').value = "";
    document.getElementById('modal-title-anio').innerText = "Nuevo Año Académico";
    document.getElementById('modal-anio').style.display = 'flex';
}

function editarAnio(id, nombre, estado) {
    document.getElementById('anio-id').value = id;
    document.getElementById('anio-nombre').value = nombre;
    document.getElementById('anio-estado').value = estado;
    document.getElementById('modal-title-anio').innerText = "Editar Año Académico";
    document.getElementById('modal-anio').style.display = 'flex';
}

function cerrarModalAnio() {
    document.getElementById('modal-anio').style.display = 'none';
}


/*---------------------------------
SECCIONES------------------------*/
function renderSeccionesView() {
    if (currentUser.role !== 'ADMINISTRADOR') {
        lanzarNotificacion('error', 'ACCESO', 'DENEGADO', 'Solo administradores.');
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <div>
                <h2 style="font-size: 2rem; color: var(--sidebar-dark);">Configuración de Secciones</h2>
                <p style="color: var(--text-muted);">Defina los grados y secciones para el año escolar actual.</p>
            </div>
            <button class="btn-primary" style="width: auto;" onclick="abrirModalSeccion()">
                <i class="material-icons" style="vertical-align: middle;">add</i> NUEVA SECCIÓN
            </button>
        </div>

        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>NIVEL</th>
                        <th>GRADO</th>
                        <th>SECCIÓN / NOMBRE</th>
                        <th>VACANTES</th>
                        <th>ACCIONES</th>
                    </tr>
                </thead>
                <tbody id="body-secciones">
                    <tr><td colspan="5" style="text-align:center;">Cargando secciones...</td></tr>
                </tbody>
            </table>
        </div>

        <div id="modal-seccion" class="modal-overlay">
            <div class="modal-content" style="max-width: 550px;">
                <h3 id="modal-title-sec">Configurar Sección</h3>
                <form id="form-seccion" onsubmit="procesarGuardadoSeccion(event)">
                    <input type="hidden" id="sec-id">
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <div>
                            <label>Nivel Educativo</label>
                            <select id="sec-nivel" class="custom-select" onchange="actualizarOpcionesGrado()" required>
                                <option value="">Seleccione...</option>
                                <option value="Primaria">Primaria</option>
                                <option value="Secundaria">Secundaria</option>
                            </select>
                        </div>
                        <div>
                            <label>Grado</label>
                            <select id="sec-grado" class="custom-select" required>
                                <option value="">Elija Nivel primero</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
                        <div>
                            <label>Nombre de Sección</label>
                            <input type="text" id="sec-nombre" placeholder="Ej: Única, A o B" required>
                        </div>
                        <div>
                            <label>Límite Vacantes</label>
                            <input type="number" id="sec-vacantes" placeholder="Ej: 30" required>
                        </div>
                    </div>

                    <div style="text-align: right; display: flex; gap: 15px; justify-content: flex-end;">
                        <button type="button" onclick="cerrarModalSeccion()" class="btn-cancel">CANCELAR</button>
                        <button type="submit" id="btn-save-sec" class="btn-primary" style="width: auto;">GUARDAR SECCIÓN</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    cargarSecciones();
}

function actualizarOpcionesGrado() {
    const nivel = document.getElementById('sec-nivel').value;
    const comboGrado = document.getElementById('sec-grado');
    let opciones = '<option value="">Seleccione Grado...</option>';

    const gradosPrimaria = ["Primero", "Segundo", "Tercero", "Cuarto", "Quinto", "Sexto"];
    const gradosSecundaria = ["Primero", "Segundo", "Tercero", "Cuarto", "Quinto"];

    if (nivel === "Primaria") {
        gradosPrimaria.forEach(g => opciones += `<option value="${g}">${g}</option>`);
    } else if (nivel === "Secundaria") {
        gradosSecundaria.forEach(g => opciones += `<option value="${g}">${g}</option>`);
    }

    comboGrado.innerHTML = opciones;
}

async function cargarSecciones() {
    const response = await sendRequest('get_secciones');
    const tbody = document.getElementById('body-secciones');
    
    if (response.status === 'success') {
        // 1. CAPTURA DEL AÑO ACTIVO:
        // Buscamos el ID del año en la respuesta del servidor y lo guardamos globalmente
        if (response.anioActivo && response.anioActivo.id) {
            anioActivoID = response.anioActivo.id;
            console.log("Sistema configurado para el año:", anioActivoID);
        } else if (response.idAnioPresente) { 
            // Por si tu servidor lo envía con otro nombre
            anioActivoID = response.idAnioPresente;
        }

        // 2. RENDERIZADO DE LA TABLA:
        // Usamos response.data (que es tu lista de secciones)
        if (response.data && response.data.length > 0) {
            tbody.innerHTML = response.data.map(sec => `
                <tr>
                    <td><span class="badge" style="background:#e0f2fe; color:#0369a1; padding:4px 10px; border-radius:12px; font-weight:700; font-size:0.7rem;">${sec.nivel}</span></td>
                    <td>${sec.grado}</td>
                    <td style="font-weight:700; color:var(--sidebar-dark);">${sec.nombre}</td>
                    <td style="text-align:center;">${sec.vacantes}</td>
                    <td style="text-align:center;">
                        <button class="btn-icon edit" title="Editar Sección" 
                            onclick="editarSeccion('${sec.id}','${sec.nivel}','${sec.grado}','${sec.nombre}',${sec.vacantes})">
                            <i class="material-icons" style="color:#0ea5e9;">edit</i>
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No hay secciones configuradas para este año.</td></tr>';
        }
    } else {
        lanzarNotificacion('error', 'SISTEMA', 'Error al cargar secciones: ' + response.message);
    }
}

async function procesarGuardadoSeccion(event) {
    event.preventDefault();
    
    // 1. Validar que tengamos un año activo cargado
    if (!anioActivoID) {
        return lanzarNotificacion('error', 'SISTEMA', 'No se ha detectado un Año Académico activo. Recargue la página.');
    }

    const btn = document.getElementById('btn-save-sec');
    const originalText = btn.innerHTML;

    // 2. Activamos animación de carga
    btn.innerHTML = '<i class="material-icons rotate" style="font-size:1.2rem; vertical-align:middle;">sync</i> GUARDANDO...';
    btn.disabled = true;

    // 3. Captura de datos corregida
    const datos = {
        id: document.getElementById('sec-id').value,
        idAnio: anioActivoID, // <--- CAMBIO CLAVE: Usamos la variable, no el texto fijo
        nivel: document.getElementById('sec-nivel').value,
        grado: document.getElementById('sec-grado').value,
        nombre: document.getElementById('sec-nombre').value,
        vacantes: document.getElementById('sec-vacantes').value
    };

    const identidad = `${datos.grado} - ${datos.nombre}`;

    try {
        const res = await sendRequest('save_seccion', datos);
        
        if(res.status === 'success') {
            cerrarModalSeccion();
            lanzarNotificacion('success', 'CONFIGURACIÓN DE SECCIONES', `Se guardó correctamente: ${identidad}`);
            cargarSecciones();
        } else {
            lanzarNotificacion('error', 'SECCIONES', res.message || 'Error al guardar');
        }
    } catch (error) {
        lanzarNotificacion('error', 'SECCIONES', "Error de conexión con el servidor.");
        console.error("Error en save_seccion:", error);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false; // Importante: Rehabilitar el botón si hay error
    }
}

function abrirModalSeccion() {
    const btn = document.getElementById('btn-save-sec');
    // RESET DEL BOTÓN
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'GUARDAR SECCIÓN'; 
    }
    document.getElementById('form-seccion').reset();
    document.getElementById('sec-id').value = "";
    document.getElementById('modal-seccion').style.display = 'flex';
}

function cerrarModalSeccion() { document.getElementById('modal-seccion').style.display = 'none'; }

/**
 * Prepara el modal para editar una sección existente.
 */
function editarSeccion(id, nivel, grado, nombre, vacantes) {
    // 1. Resetear el estado del botón de guardado
    const btn = document.getElementById('btn-save-sec');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'ACTUALIZAR SECCIÓN';
    }

    // 2. Cambiar el título del modal
    document.getElementById('modal-title-sec').innerText = "Editar Sección";

    // 3. Llenar los campos de identificación y nivel
    document.getElementById('sec-id').value = id;
    document.getElementById('sec-nivel').value = nivel;

    // 4. ¡CRÍTICO! Actualizar los grados disponibles según el nivel
    // antes de intentar asignar el valor del grado.
    actualizarOpcionesGrado();

    // 5. Asignar el resto de los valores
    document.getElementById('sec-grado').value = grado;
    document.getElementById('sec-nombre').value = nombre;
    document.getElementById('sec-vacantes').value = vacantes;

    // 6. Mostrar el modal
    document.getElementById('modal-seccion').style.display = 'flex';
}

//------MATRÍCULA MASIVA-------------------------------------------------------------
let listaAlumnosLocal = []; // Para filtrar sin volver al servidor

function renderMatriculaMasivaView() {
    // 1. Validación de Roles
    if (currentUser.role !== 'ADMINISTRADOR' && currentUser.role !== 'SECRETARIA') {
        lanzarNotificacion('error', 'ACCESO', 'DENEGADO', 'No autorizado.');
        return;
    }

    // 2. NUEVO: Validación de Año Activo Global
    // Si por alguna razón la variable global está vacía, detenemos el proceso.
    if (!anioActivoID) {
        lanzarNotificacion('error', 'ERROR DE CONFIGURACIÓN', 'No se ha detectado un Año Académico activo en el sistema.');
        return;
    }

    const content = document.getElementById('content-area');
    
    // 3. CAMBIO: Inyectamos ${anioActivoNombre} directamente en el HTML
    content.innerHTML = `
        <div class="module-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
                <h2>Registrar Matrículas</h2>
                <p>Registre alumnos en bloque para el periodo lectivo.</p>
            </div>
            <div id="anio-actual-label" class="anio-indicador">
                <i class="material-icons">event_available</i>
                <span>${anioActivoNombre}</span>
            </div>
        </div>

        <div class="card-config" style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: var(--shadow-sm);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; align-items: flex-end;">
                <div>
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Nivel Educativo</label>
                    <select id="mat-nivel" class="custom-select" onchange="actualizarCombosMasivos('nivel')">
                        <option value="">Cargando datos...</option>
                    </select>
                </div>
                <div>
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Grado</label>
                    <select id="mat-grado" class="custom-select" disabled onchange="actualizarCombosMasivos('grado')">
                        <option value="">Seleccione Nivel...</option>
                    </select>
                </div>
                <div>
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Sección de Destino</label>
                    <select id="mat-seccion" class="custom-select" disabled>
                        <option value="">Seleccione Grado...</option>
                    </select>
                </div>
                <div style="display: flex; justify-content: center;">
                    <button id="btn-matricular" class="btn-matricula-especial" onclick="ejecutarMatriculaMasiva()">
                        <i class="material-icons">how_to_reg</i> CONFIRMAR MATRÍCULA
                    </button>
                </div>
            </div>
        </div>

        <div class="table-container">
            <div style="padding: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                <h3 style="margin:0; font-size: 1.1rem;">Alumnos Pendientes</h3>
                
                <div class="search-container-masivo">
                    <i class="material-icons">search</i>
                    <input type="text" id="busqueda-alumnos" placeholder="Buscar por Apellidos o DNI..." onkeyup="filtrarTablaAlumnos()">
                    <button id="btn-limpiar-busqueda" class="btn-clear-search" onclick="limpiarBusquedaAlumnos()">
                        <i class="material-icons">cancel</i>
                    </button>
                </div>
            </div>

            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;"><input type="checkbox" id="check-all" onclick="toggleTodosAlumnos(this)"></th>
                        <th>DNI</th>
                        <th>APELLIDOS Y NOMBRES</th>
                    </tr>
                </thead>
                <tbody id="body-matricula-masiva">
                    <tr><td colspan="3" style="text-align:center;">
                        <div class="spinner"></div> Conectando con base de datos...
                    </td></tr>
                </tbody>
            </table>
        </div>
    `;
    
    // --- AQUÍ ESTÁ EL TRUCO DE VELOCIDAD ---
    // 1. Llenamos el combo INMEDIATAMENTE usando la memoria local
    if (seccionesGlobal.length > 0) {
        const comboNivel = document.getElementById('mat-nivel');
        const nivelesUnicos = [...new Set(seccionesGlobal.map(s => s.nivel))];
        
        comboNivel.innerHTML = '<option value="">Seleccione Nivel...</option>' + 
            nivelesUnicos.map(n => `<option value="${n}">${n}</option>`).join('');
            
        // Habilitamos el combo visualmente al instante
        comboNivel.disabled = false;
    }

    // 2. Ahora sí, llamamos al servidor en segundo plano SOLO para traer los alumnos
    inicializarDatosMatricula();
}


async function inicializarDatosMatricula() {
    try {
        const res = await sendRequest('get_datos_para_matricula', { 
            idAnio: anioActivoID 
        });

        if (res.status === 'success') {
            listaAlumnosLocal = res.estudiantes; 
            
            // Esta función ya tiene su propio escudo interno ahora
            dibujarTablaAlumnos(listaAlumnosLocal);

        } else {
            // ESCUDO: Validar existencia antes de poner mensaje de error
            const tbody = document.getElementById('body-matricula-masiva');
            if (tbody) {
                tbody.innerHTML = 
                    `<tr><td colspan="3" style="text-align:center; color:red;">
                        <i class="material-icons" style="vertical-align:middle; font-size:16px;">error</i> 
                        ${res.message}
                    </td></tr>`;
            }
            lanzarNotificacion('error', 'SISTEMA', res.message);
        }
    } catch (error) {
        console.error("Error crítico en inicializarDatosMatricula:", error);
        const tbody = document.getElementById('body-matricula-masiva');
        if (tbody) {
            tbody.innerHTML = 
                `<tr><td colspan="3" style="text-align:center; color:red;">Error de conexión con el servidor</td></tr>`;
        }
    }
}


function actualizarCombosMasivos(paso) {
    const nivel = document.getElementById('mat-nivel').value;
    const gradoSel = document.getElementById('mat-grado');
    const seccionSel = document.getElementById('mat-seccion');

    if (paso === 'nivel') {
        const grados = [...new Set(seccionesGlobal.filter(s => s.nivel === nivel).map(s => s.grado))];
        gradoSel.innerHTML = '<option value="">Seleccione Grado...</option>' + 
            grados.map(g => `<option value="${g}">${g}</option>`).join('');
        gradoSel.disabled = false;
        seccionSel.innerHTML = '<option value="">Seleccione Grado primero...</option>';
        seccionSel.disabled = true;
    } else if (paso === 'grado') {
        const grado = gradoSel.value;
        const secciones = seccionesGlobal.filter(s => s.nivel === nivel && s.grado === grado);
        seccionSel.innerHTML = '<option value="">Seleccione Sección...</option>' + 
            secciones.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
        seccionSel.disabled = false;
    }
}

function filtrarSeccionesDestino() {
    const nivel = document.getElementById('mat-nivel').value;
    const combo = document.getElementById('mat-seccion');
    const filtradas = seccionesGlobal.filter(s => !nivel || s.nivel === nivel);
    
    combo.innerHTML = '<option value="">Seleccione Sección...</option>' + 
        filtradas.map(s => `<option value="${s.id}">${s.grado} - ${s.nombre}</option>`).join('');
}

function dibujarTablaAlumnos(lista) {
    const tbody = document.getElementById('body-matricula-masiva');
    
    // ESCUDO: Si el elemento no existe (porque cambiaste de vista), salimos en paz.
    if (!tbody) return;
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px;">No se encontraron alumnos con ese criterio.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(al => `
        <tr>
            <td style="text-align: center;">
                <input type="checkbox" class="alumno-check" value="${al.id}" onchange="actualizarContadorSeleccionados()">
            </td>
            <td style="font-family: 'Roboto Mono', monospace;">${al.dni}</td>
            <td style="font-weight: 600;">${al.nombreCompleto}</td>
        </tr>
    `).join('');
}

function filtrarTablaAlumnos() {
    const input = document.getElementById('busqueda-alumnos');
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    const busqueda = input.value.toLowerCase().trim();
    
    // Mostrar/Ocultar botón X
    btnLimpiar.style.display = busqueda.length > 0 ? 'block' : 'none';
    
    const filtrados = listaAlumnosLocal.filter(al => 
        al.nombreCompleto.toLowerCase().includes(busqueda) || al.dni.toString().includes(busqueda)
    );
    dibujarTablaAlumnos(filtrados);
}

function toggleTodosAlumnos(source) {
    const checks = document.querySelectorAll('.alumno-check');
    checks.forEach(c => c.checked = source.checked);
}

async function ejecutarMatriculaMasiva() {
    const idSeccion = document.getElementById('mat-seccion').value;
    const seleccionados = Array.from(document.querySelectorAll('.alumno-check:checked')).map(c => c.value);
    const btn = document.getElementById('btn-matricular');

    if (!idSeccion) return lanzarNotificacion('error', 'MATRÍCULA', 'Debe seleccionar una sección de destino.');
    if (seleccionados.length === 0) return lanzarNotificacion('error', 'MATRÍCULA', 'Seleccione al menos un alumno de la lista.');

    // Bloqueo y animación del botón
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';
    btn.disabled = true;

    try {
        const res = await sendRequest('procesar_matricula_masiva', {
            idSeccion: idSeccion,
            idAnio: anioActivoID,
            estudiantesIds: seleccionados
        });

        if (res.status === 'success') {
            // NOTIFICACIÓN CON RESUMEN FINAL
            lanzarNotificacion('success', 'MATRÍCULA EXITOSA', res.message);
            
            // --- ACTUALIZACIÓN DEL DASHBOARD ---
            cacheDashboardData = null; // Borramos la memoria local del navegador
            cargarDatosDashboard();    // Pedimos al servidor los nuevos números
            // ----------------------------------

            // Recargamos la vista para limpiar la lista de alumnos ya matriculados
            renderMatriculaMasivaView(); 
        } else {
            lanzarNotificacion('error', 'FALLO EN REGISTRO', res.message);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        lanzarNotificacion('error', 'SISTEMA', 'Error de conexión al procesar la matrícula.');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function limpiarBusquedaAlumnos() {
    const input = document.getElementById('busqueda-alumnos');
    input.value = '';
    filtrarTablaAlumnos(); // Esto resetea la tabla y oculta el botón
    input.focus();
}

function actualizarContadorSeleccionados() {
    // 1. Buscamos todos los checkboxes de estudiantes que estén marcados
    const checkboxes = document.querySelectorAll('.chk-est:checked');
    const cantidad = checkboxes.length;

    // 2. Buscamos el botón de acción masiva
    const btn = document.getElementById('btn-matricular-masivo');
    
    if (btn) {
        // Actualizamos el texto del botón
        btn.innerHTML = `
            <i class="material-icons" style="margin-right:10px;">school</i> 
            MATRICULAR SELECCIONADOS (${cantidad})
        `;
        
        // Si hay al menos 1 seleccionado, activamos el botón (quitamos opacidad y cursor)
        if (cantidad > 0) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        } else {
            // Si es 0, lo desactivamos visualmente
            btn.disabled = true;
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
        }
    }
}

/*--------------------------------------------------------------------*/
/*CONSULTAS--------------------------------------------*/
let dataConsultas = {};

/* --- ACTUALIZACIÓN EN SCRIPT.JS --- */

function renderSeccionesConsultasView() {
    // ... (Validación de roles igual que antes) ...
    const rolesPermitidos = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO', 'AUXILIAR'];
    if (!rolesPermitidos.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tienes permisos para ver esta sección.');
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header">
            <h2>Consultas de Matrícula y Secciones</h2>
            <p>Historial por estudiante y listas de clase por sección.</p>
        </div>

        <div class="tabs-container">
            <button class="tab-button active" onclick="switchTab('tab-estudiante')">POR ESTUDIANTE</button>
            <button class="tab-button" onclick="switchTab('tab-seccion')">POR SECCIÓN</button>
        </div>

        <div id="tab-estudiante" class="tab-content active">
             <div class="card-config" style="background:white; padding:20px; border-radius:12px; margin-bottom:20px;">
                <div class="search-container-masivo">
                    <i class="material-icons">search</i>
                    <input type="text" id="busqueda-historial" placeholder="Buscar por Apellido o DNI..." onkeyup="filtrarHistorialEstudiante()">
                    <button class="btn-clear-search" id="btn-clear-historial" onclick="limpiarBusquedaHistorial()">
                        <i class="material-icons">cancel</i>
                    </button>
                </div>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr><th>APELLIDOS Y NOMBRES</th><th>DNI</th><th>AÑO LECTIVO</th><th>GRADO / SECCIÓN</th><th>ESTADO</th><th>ACCIONES</th></tr>
                    </thead>
                    <tbody id="body-historial">
                        <tr><td colspan="6" style="text-align:center;">Use el buscador para ver el historial.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div id="tab-seccion" class="tab-content">
            <div class="card-config" style="background:white; padding:20px; border-radius:12px; margin-bottom:20px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; align-items: flex-end;">
                    <div><label>Año Académico</label><select id="con-anio" class="custom-select" onchange="actualizarFiltrosSeccion()"></select></div>
                    <div><label>Nivel</label><select id="con-nivel" class="custom-select" onchange="alCambiarNivel()"></select></div>
                    <div><label>Grado</label><select id="con-grado" class="custom-select" onchange="alCambiarGrado()"></select></div>
                    <div><label>Sección</label><select id="con-seccion" class="custom-select" onchange="consultarListaSeccion()"></select></div>
                    
                    <div style="display: flex; justify-content: flex-end;">
                        <button onclick="imprimirListaSeccion()" class="btn-primary" style="background: #475569; width: 100%;">
                            <i class="material-icons">print</i> IMPRIMIR LISTA
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="table-container">
                <table class="data-table" id="tabla-reporte-seccion">
                    <thead>
                        <tr>
                            <th>N°</th>
                            <th>DNI</th>
                            <th>APELLIDOS Y NOMBRES</th>
                            <th>FECHA MATRÍCULA</th>
                            <th>ACCIONES</th> </tr>
                    </thead>
                    <tbody id="body-lista-seccion">
                        <tr><td colspan="5" style="text-align:center;">Seleccione los filtros para mostrar la lista.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    inicializarDataConsultas();
}

// --- LÓGICA PESTAÑA 1: POR ESTUDIANTE (ACTUALIZADA CON BOTONES) ---
function filtrarHistorialEstudiante() {
    const input = document.getElementById('busqueda-historial');
    const btnLimpiar = document.getElementById('btn-clear-historial');
    const tbody = document.getElementById('body-historial');
    const puedeEditar = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'].includes(currentUser.role);
    
    if (!dataConsultas.estudiantes) return;

    const busqueda = input.value.toLowerCase().trim();
    btnLimpiar.style.display = busqueda ? 'block' : 'none';

    if (busqueda.length < 1) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Escriba al menos un apellido o DNI...</td></tr>';
        return;
    }

    const filtrados = dataConsultas.estudiantes.filter(e => {
        const nombre = String(e.nombreCompleto || "").toLowerCase();
        const dni = String(e.dni || "");
        return nombre.includes(busqueda) || dni.includes(busqueda);
    });

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No se encontraron estudiantes.</td></tr>';
        return;
    }

    let html = "";
    filtrados.forEach(est => {
        const mats = dataConsultas.matriculas.filter(m => m.idEst === est.id);
        const nombreMayus = String(est.nombreCompleto).toUpperCase();
        
        if (mats.length === 0) {
            html += `<tr>
                <td style="font-weight:700;">${nombreMayus}</td>
                <td>${est.dni}</td>
                <td colspan="4" style="color:gray; font-style:italic; text-align:center;">Sin registro de matrículas</td>
            </tr>`;
        } else {
            mats.sort((a,b) => b.fecha - a.fecha).forEach(m => {
                const anio = dataConsultas.anios.find(a => a.id === m.idAnio);
                const sec = dataConsultas.secciones.find(s => s.id === m.idSec);
                const esActivo = m.estado === 'ACTIVO' && anio && anio.estado === 'ACTIVO';
                const rowStyle = esActivo ? 'background-color: #f0fdf4; border-left: 4px solid #22c55e;' : '';

                html += `<tr style="${rowStyle}">
                    <td style="font-weight:700;">${nombreMayus}</td>
                    <td>${est.dni}</td>
                    <td>${anio ? anio.nombre : 'N/A'}</td>
                    <td>${sec ? `${sec.grado} - ${sec.nombre}` : 'N/A'}</td>
                    <td><span class="badge" style="background:${esActivo ? '#22c55e' : '#94a3b8'}; color:white;">${m.estado}</span></td>
                    <td style="text-align:center;">
                        <div class="action-buttons" style="justify-content: center; gap: 8px;">
                            <button class="btn-icon edit" style="background:#0ea5e9; color:white; width:auto; padding: 0 10px;" onclick="verExpediente('${est.id}', this)">
                                <i class="material-icons">visibility</i> VER
                            </button>
                            
                            ${puedeEditar ? `
                            <button class="btn-icon delete" style="background:#f59e0b; color:white; width:auto; padding: 0 10px;" onclick="abrirModalEstado('${m.id}', '${m.estado}', '${nombreMayus}')">
                                <i class="material-icons">history_edu</i> ESTADO
                            </button>
                            <button class="btn-icon" style="background:#14b8a6; color:white; width:auto; padding: 0 10px;" onclick="abrirModalCambiarSeccion('${m.id}', '${m.idSec}', '${nombreMayus}')">
                                <i class="material-icons">swap_horiz</i> SECCIÓN
                            </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>`;
            });
        }
    });
    tbody.innerHTML = html;
}


async function inicializarDataConsultas() {
    const res = await sendRequest('get_consultas_secciones');
    if (res.status === 'success') {
        dataConsultas = res;
        
        // Llenar Año por default con el Activo
        const comboAnio = document.getElementById('con-anio');
        comboAnio.innerHTML = res.anios.map(a => `<option value="${a.id}" ${a.estado === 'ACTIVO' ? 'selected' : ''}>${a.nombre}</option>`).join('');
        
        actualizarFiltrosSeccion(); // Cargar niveles iniciales
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
}



// --- LÓGICA PESTAÑA 2: POR SECCIÓN ---
function actualizarFiltrosSeccion() {
    limpiarTablaSeccion(); // <-- Reiniciar tabla
    
    const idAnio = document.getElementById('con-anio').value;
    const comboNivel = document.getElementById('con-nivel');
    const comboGrado = document.getElementById('con-grado');
    const comboSeccion = document.getElementById('con-seccion');

    const seccionesAnio = dataConsultas.secciones.filter(s => s.idAnio === idAnio);

    // Llenar Niveles
    const niveles = [...new Set(seccionesAnio.map(s => s.nivel))];
    comboNivel.innerHTML = '<option value="">Seleccione Nivel...</option>' + 
        niveles.map(n => `<option value="${n}">${n}</option>`).join('');

    // Resetear hijos
    comboGrado.innerHTML = '<option value="">Seleccione Nivel primero...</option>';
    comboSeccion.innerHTML = '<option value="">Seleccione Grado primero...</option>';
}

// 2. Cuando cambia el NIVEL
function alCambiarNivel() {
    limpiarTablaSeccion(); // <-- Reiniciar tabla
    
    const idAnio = document.getElementById('con-anio').value;
    const nivel = document.getElementById('con-nivel').value;
    const comboGrado = document.getElementById('con-grado');
    const comboSeccion = document.getElementById('con-seccion');

    if (!nivel) {
        comboGrado.innerHTML = '<option value="">Seleccione Nivel primero...</option>';
        return;
    }

    const grados = [...new Set(dataConsultas.secciones
        .filter(s => s.idAnio === idAnio && s.nivel === nivel)
        .map(s => s.grado))];

    comboGrado.innerHTML = '<option value="">Seleccione Grado...</option>' + 
        grados.map(g => `<option value="${g}">${g}</option>`).join('');
    
    comboSeccion.innerHTML = '<option value="">Seleccione Grado primero...</option>';
}

// 3. Cuando cambia el GRADO
function alCambiarGrado() {
    limpiarTablaSeccion(); // <-- Reiniciar tabla
    
    const idAnio = document.getElementById('con-anio').value;
    const nivel = document.getElementById('con-nivel').value;
    const grado = document.getElementById('con-grado').value;
    const comboSeccion = document.getElementById('con-seccion');

    if (!grado) {
        comboSeccion.innerHTML = '<option value="">Seleccione Grado primero...</option>';
        return;
    }

    const secs = dataConsultas.secciones.filter(s => 
        s.idAnio === idAnio && s.nivel === nivel && s.grado === grado
    );

    comboSeccion.innerHTML = '<option value="">Seleccione Sección...</option>' + 
        secs.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}


// 4. Cuando cambia la SECCIÓN (Muestra los datos)

function limpiarBusquedaHistorial() {
    const input = document.getElementById('busqueda-historial');
    input.value = "";
    filtrarHistorialEstudiante();
    input.focus();
}

// Función auxiliar para resetear la tabla a su estado inicial
function limpiarTablaSeccion() {
    const tbody = document.getElementById('body-lista-seccion');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #94a3b8;">Seleccione los filtros para mostrar la lista.</td></tr>';
    }
}


/*Lógica de la Tabla y Modales - Pestaña POR SECCIÓN*/
/* --- ACTUALIZAR EN SCRIPT.JS --- */

function consultarListaSeccion() {
    const idSec = document.getElementById('con-seccion').value;
    const tbody = document.getElementById('body-lista-seccion');

    if (!tbody) return; // Seguridad

    if (!idSec) { 
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Seleccione una sección.</td></tr>'; 
        return; 
    }

    // 1. Filtrar matrículas activas de la sección
    const matriculasRaw = dataConsultas.matriculas.filter(m => m.idSec === idSec && m.estado === 'ACTIVO');
    
    // 2. UNIR DATOS: Creamos una lista temporal que combina Matrícula + Estudiante
    let listaCompleta = matriculasRaw.map(m => {
        const est = dataConsultas.estudiantes.find(e => e.id === m.idEst);
        return est ? { matricula: m, estudiante: est } : null;
    }).filter(item => item !== null); // Filtramos si no se encontró el alumno (por seguridad)

    // 3. ORDENAR ALFABÉTICAMENTE: Usamos el nombre del estudiante
    listaCompleta.sort((a, b) => {
        const nombreA = (a.estudiante.nombreCompleto || "").toString().toLowerCase();
        const nombreB = (b.estudiante.nombreCompleto || "").toString().toLowerCase();
        return nombreA.localeCompare(nombreB);
    });

    const puedeEditar = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'].includes(currentUser.role);
    let html = "";

    // 4. GENERAR HTML (Ahora recorremos la lista ya ordenada)
    listaCompleta.forEach((item, index) => {
        const m = item.matricula;
        const est = item.estudiante;
        
        const nombreMayus = String(est.nombreCompleto).toUpperCase();
        
        // Validación segura de fecha
        let fechaMat = '---';
        if (m.fecha) {
             const d = new Date(m.fecha);
             // Ajuste para evitar error "Invalid Date"
             if (!isNaN(d.getTime())) {
                 fechaMat = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
             }
        }

        html += `
        <tr>
            <td style="text-align:center;">${index + 1}</td>
            <td style="font-family: monospace;">${est.dni}</td>
            <td style="font-weight:700;">${nombreMayus}</td>
            <td style="text-align:center; color: #64748b;">${fechaMat}</td>
            <td style="text-align:center;">
                <div class="action-buttons" style="justify-content: center; gap: 8px;">
                    <button class="btn-icon edit" style="background:#0ea5e9; color:white; width:auto; padding: 0 10px;" onclick="verExpediente('${est.id}', this)" title="Ver Expediente">
                        <i class="material-icons">visibility</i> VER
                    </button>
                    
                    ${puedeEditar ? `
                    <button class="btn-icon delete" style="background:#f59e0b; color:white; width:auto; padding: 0 10px;" onclick="abrirModalEstado('${m.id}', '${m.estado}', '${nombreMayus}')" title="Cambiar Estado">
                        <i class="material-icons">history_edu</i> ESTADO
                    </button>
                    <button class="btn-icon" style="background:#14b8a6; color:white; width:auto; padding: 0 10px;" onclick="abrirModalCambiarSeccion('${m.id}', '${m.idSec}', '${nombreMayus}')" title="Traslado Interno">
                        <i class="material-icons">swap_horiz</i> SECCIÓN
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>`;
    });

    tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding: 20px;">No hay alumnos matriculados en esta sección.</td></tr>';
}

// --- MODAL VER EXPEDIENTE ---
async function verExpediente(idEst, btn) {
    // 1. Animación de carga y bloqueo del botón
    const contenidoOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="material-icons rotate" style="font-size: 18px;">sync</i>'; // Necesitas la clase 'rotate' en tu CSS
    btn.disabled = true;

    try {
        const res = await sendRequest('get_expediente', { idEst: idEst });
        
        if (res.status === 'success') {
            const est = res.estudiante;
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            
            // Formatear fecha de nacimiento
            const fechaNac = est[6] ? new Date(est[6]).toLocaleDateString('es-ES') : 'NO REGISTRADO';

            modal.innerHTML = `
                <div class="modal-content" style="max-width: 800px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 30px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom: 2px solid #0369a1; padding-bottom:10px;">
                        <h2 style="color: #0369a1; margin:0; font-weight: 800;">FICHA DE MATRÍCULA</h2>
                        <button class="btn-icon" onclick="this.closest('.modal-overlay').remove()"><i class="material-icons">close</i></button>
                    </div>

                    <div class="modal-sub-header">DATOS DEL ESTUDIANTE</div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:18px 40px; margin-bottom:25px; padding: 10px;">
                            
                            <div style="grid-column: span 2; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px;">
                                <span class="data-label-outline">APELLIDOS Y NOMBRES</span> 
                                <div style="font-weight: 800; font-size: 1.15rem; color: #0f172a; margin-top:6px;">
                                    ${String(est[1] + ' ' + est[2] + ', ' + est[3]).toUpperCase()}
                                </div>
                            </div>

                            <div>
                                <span class="data-label-outline">N° DOCUMENTO (DNI)</span>
                                <div style="font-weight: 600; color: #334155; margin-top:5px;">${est[4]}</div>
                            </div>

                            <div>
                                <span class="data-label-outline">SEXO / GÉNERO</span>
                                <div style="font-weight: 600; color: #334155; margin-top:5px;">${String(est[5] || '---').toUpperCase()}</div>
                            </div>

                            <div>
                                <span class="data-label-outline">FECHA DE NACIMIENTO</span>
                                <div style="font-weight: 600; color: #334155; margin-top:5px;">${fechaNac}</div>
                            </div>

                            <div>
                                <span class="data-label-outline">DIRECCIÓN ACTUAL</span>
                                <div style="font-weight: 600; color: #334155; margin-top:5px;">${String(est[7] || '---').toUpperCase()}</div>
                            </div>
                        </div>

                    <div class="modal-sub-header">DATOS DE LOS RESPONSABLES</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:25px;">
                        <div style="border: 1px solid #bae6fd; padding:10px; border-radius:8px;">
                            <div style="font-weight:bold; color:#0369a1; font-size:0.7rem; margin-bottom:5px;">PRINCIPAL (${String(est[9] || 'RESPONSABLE 1').toUpperCase()})</div>
                            ${res.responsable1 ? `
                                <div style="font-weight:700;">${String(res.responsable1[1] + ' ' + res.responsable1[2] + ', ' + res.responsable1[3]).toUpperCase()}</div>
                                <div style="font-size:0.85rem;">DNI: ${res.responsable1[4]} | TELÉFONO: ${res.responsable1[5]}</div>
                            ` : 'No asignado'}
                        </div>
                        <div style="border: 1px solid #bae6fd; padding:10px; border-radius:8px;">
                            <div style="font-weight:bold; color:#0369a1; font-size:0.7rem; margin-bottom:5px;">SECUNDARIO (${String(est[11] || 'RESPONSABLE 2').toUpperCase()})</div>
                            ${res.responsable2 ? `
                                <div style="font-weight:700;">${String(res.responsable2[1] + ' ' + res.responsable2[2] + ', ' + res.responsable2[3]).toUpperCase()}</div>
                                <div style="font-size:0.85rem;">DNI: ${res.responsable2[4]} | TELÉFONO: ${res.responsable2[5]}</div>
                            ` : 'No asignado'}
                        </div>
                    </div>

                    <div class="modal-sub-header">HISTORIAL DE MATRÍCULAS</div>
                    <table class="data-table" style="font-size:0.85rem;">
                        <thead><tr><th>AÑO</th><th>SECCIÓN</th><th>FECHA</th><th>ESTADO</th></tr></thead>
                        <tbody>
                            ${res.historial.map(h => `
                                <tr>
                                    <td>${h.anio}</td>
                                    <td>${h.detalle.toUpperCase()}</td>
                                    <td>${new Date(h.fecha).toLocaleDateString()}</td>
                                    <td><span class="badge" style="background:${h.estado === 'ACTIVO' ? '#22c55e' : '#ef4444'}; color:white;">${h.estado}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            lanzarNotificacion('error', 'SISTEMA', res.message);
        }
    } catch (error) {
        lanzarNotificacion('error', 'ERROR', 'Error al procesar la ficha.');
        console.error(error);
    } finally {
        // 2. Restaurar el botón independientemente del resultado
        btn.innerHTML = contenidoOriginal;
        btn.disabled = false;
    }
}

// --- MODAL ESTADO DE MATRÍCULA ---
function abrirModalEstado(idMat, estadoActual, nombreEst) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-seleccion-estado'; // ID para poder cerrarlo luego
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <h3 style="margin-top:0;">CAMBIAR ESTADO</h3>
            <p>Estudiante: <strong>${nombreEst}</strong></p>
            <label>Seleccione el nuevo estado:</label>
            <select id="nuevo-estado-mat" class="custom-select" style="margin-bottom:20px;">
                <option value="ACTIVO" ${estadoActual === 'ACTIVO' ? 'selected' : ''}>ACTIVO</option>
                <option value="TRASLADADO" ${estadoActual === 'TRASLADADO' ? 'selected' : ''}>TRASLADADO</option>
            </select>
            <div style="background:#fff7ed; border-left:4px solid #f97316; padding:10px; margin-bottom:20px; font-size:0.85rem; color:#9a3412;">
                <strong>ADVERTENCIA:</strong> Esta acción modificará el registro oficial de matrícula.
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">CANCELAR</button>
                <button class="btn-primary" style="width:auto;" onclick="pedirConfirmacionCambio('${idMat}', '${nombreEst}')">GUARDAR CAMBIOS</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function pedirConfirmacionCambio(idMat, nombreEst) {
    const nuevoEstado = document.getElementById('nuevo-estado-mat').value;
    
    const modalConfirm = document.createElement('div');
    modalConfirm.className = 'notify-overlay'; // Usamos el overlay de notificaciones
    modalConfirm.id = 'confirm-notify';
    modalConfirm.style.display = 'flex';
    
    modalConfirm.innerHTML = `
        <div class="notify-card success" style="border-top: 5px solid #f59e0b;">
            <i class="material-icons" style="color: #f59e0b;">help_outline</i>
            <h3>¿ESTÁ SEGURO?</h3>
            <p>Va a cambiar el estado de <b>${nombreEst}</b> a:</p>
            <div style="font-size: 1.3rem; font-weight: 800; color: #f59e0b; margin: 15px 0;">
                ${nuevoEstado}
            </div>
            <p style="font-size: 0.85rem; margin-bottom: 25px;">Esta acción quedará registrada en el historial.</p>
            
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button class="btn-cancel" onclick="document.getElementById('confirm-notify').remove()">NO, CANCELAR</button>
                <button class="btn-primary" style="background: #f59e0b; width: auto;" 
                    onclick="ejecutarCambioEstadoFinal('${idMat}', '${nuevoEstado}')">SÍ, CONFIRMAR</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalConfirm);
}

async function ejecutarCambioEstadoFinal(idMat, nuevoEstado) {
    const btnConfirmar = document.querySelector('#confirm-notify .btn-primary');
    const originalHTML = btnConfirmar.innerHTML;
    
    btnConfirmar.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';
    btnConfirmar.disabled = true;

    try {
        const res = await sendRequest('update_estado_mat', { idMat: idMat, estado: nuevoEstado });
        
        if (res.status === 'success') {
            // Actualizar memoria local
            const index = dataConsultas.matriculas.findIndex(m => m.id === idMat);
            if (index !== -1) dataConsultas.matriculas[index].estado = nuevoEstado;

            // Cerrar todos los modales abiertos
            document.getElementById('confirm-notify').remove();
            if (document.getElementById('modal-seleccion-estado')) {
                document.getElementById('modal-seleccion-estado').remove();
            }

            lanzarNotificacion('success', 'SISTEMA', res.message);
            consultarListaSeccion(); // Refrescar tabla
            if (document.getElementById('busqueda-historial')) filtrarHistorialEstudiante();

        } else {
            lanzarNotificacion('error', 'ERROR', res.message);
            btnConfirmar.innerHTML = originalHTML;
            btnConfirmar.disabled = false;
        }
    } catch (error) {
        lanzarNotificacion('error', 'CONEXIÓN', 'Fallo al conectar con el servidor.');
        btnConfirmar.innerHTML = originalHTML;
        btnConfirmar.disabled = false;
    }
}


function abrirModalCambiarSeccion(idMat, idSecActual, nombreEst) {
    // 1. Encontrar datos de la sección actual para filtrar
    const secActual = dataConsultas.secciones.find(s => s.id === idSecActual);
    
    // 2. Filtrar secciones del mismo Año, Nivel y Grado, pero con ID diferente
    const opciones = dataConsultas.secciones.filter(s => 
        s.idAnio === secActual.idAnio && 
        s.nivel === secActual.nivel && 
        s.grado === secActual.grado && 
        s.id !== idSecActual
    );

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 450px;">
            <h3 style="margin-top:0; color:#14b8a6;">CAMBIAR SECCIÓN DE AULA</h3>
            <p>Estudiante: <strong>${nombreEst}</strong></p>
            <p style="font-size:0.85rem; color:#64748b;">Grado actual: ${secActual.grado} - ${secActual.nivel}</p>
            
            <label>Seleccione la nueva sección de destino:</label>
            <select id="nueva-sec-id" class="custom-select" style="margin-bottom:20px;">
                <option value="">-- Seleccionar Sección --</option>
                ${opciones.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('')}
            </select>

            <div style="background:#f0fdfa; border-left:4px solid #14b8a6; padding:10px; margin-bottom:20px; font-size:0.85rem; color:#0f766e;">
                <strong>NOTA:</strong> El estudiante desaparecerá de esta lista y aparecerá automáticamente en la lista de la nueva sección seleccionada.
            </div>

            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">CANCELAR</button>
                <button class="btn-primary" style="background:#14b8a6; border:none; width:auto;" onclick="confirmarCambioSeccion('${idMat}')">MOVER AHORA</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function confirmarCambioSeccion(idMat) {
    const nuevaSecId = document.getElementById('nueva-sec-id').value;
    const btn = document.querySelector('.modal-content .btn-primary');
    
    if (!nuevaSecId) return lanzarNotificacion('error', 'SISTEMA', 'Seleccione una sección de destino.');

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';
    btn.disabled = true;

    try {
        const res = await sendRequest('cambiar_seccion', { idMat: idMat, nuevaSeccionId: nuevaSecId });
        
        if (res.status === 'success') {
            // Actualizar memoria local
            const index = dataConsultas.matriculas.findIndex(m => m.id === idMat);
            if (index !== -1) dataConsultas.matriculas[index].idSec = nuevaSecId;

            lanzarNotificacion('success', 'ÉXITO', res.message);
            document.querySelector('.modal-overlay').remove();
            
            // Refrescar tabla: el alumno desaparecerá de la lista actual
            consultarListaSeccion(); 
        } else {
            lanzarNotificacion('error', 'ERROR', res.message);
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    } catch (error) {
        lanzarNotificacion('error', 'CONEXIÓN', 'Error al procesar el traslado.');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

/*VER TRASLADOS---------------------------------------*/
let datosTrasladosLocal = []; // Para filtrar sin recargar del servidor

function renderTrasladosView() {
    const rolesAutorizados = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!rolesAutorizados.includes(currentUser.role)) {
        return `<div class="container-fluid"><p class="p-4 text-danger">Acceso denegado. No tiene permisos para ver traslados.</p></div>`;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header">
            <h2>Gestión de Traslados</h2>
            <p>Historial de estudiantes con estado de matrícula "Trasladado".</p>
        </div>

        <div class="card-config" style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; gap: 20px; align-items: flex-end; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Filtrar por Año Académico</label>
                    <select id="filtro-traslado-anio" class="custom-select" onchange="filtrarTablaTraslados()">
                        <option value="">Cargando años...</option>
                    </select>
                </div>
                <div style="flex: 2; min-width: 300px;">
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Buscar Estudiante</label>
                    <div class="search-container-masivo" style="width: 100%; margin: 0;">
                        <i class="material-icons">search</i>
                        <input type="text" id="busqueda-traslados" placeholder="DNI o Apellidos..." onkeyup="filtrarTablaTraslados()">
                    </div>
                </div>
            </div>
        </div>

        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>FECHA</th>
                        <th>DNI</th>
                        <th>ESTUDIANTE</th>
                        <th style="text-align:center;">ESTADO</th>
                        <th>RESPONSABLE</th>
                    </tr>
                </thead>
                <tbody id="body-traslados">
                    <tr><td colspan="5" style="text-align:center;">Cargando historial...</td></tr>
                </tbody>
            </table>
        </div>
    `;
    inicializarTraslados();
}

async function inicializarTraslados() {
    const labelAnio = document.getElementById('filtro-traslado-anio');
    try {
        const res = await sendRequest('get_datos_traslados');
        
        if (res.status === 'success') {
            datosTrasladosLocal = res.traslados;
            
            // 1. Construir el selector de años
            // Usamos TODOS como opción por defecto si no hay año activo
            let htmlAnios = '<option value="TODOS">-- Todos los años --</option>';
            
            res.anios.forEach(a => {
                // Si el año es el activo, lo marcamos como seleccionado por defecto
                const esActivo = (String(a.id) === String(anioActivoID));
                htmlAnios += `<option value="${a.id}" ${esActivo ? 'selected' : ''}>${a.nombre} ${a.estado === 'ACTIVO' ? '(ACTUAL)' : ''}</option>`;
            });

            if (labelAnio) labelAnio.innerHTML = htmlAnios;

            // 2. Ejecutar el primer filtrado
            filtrarTablaTraslados();
        }
    } catch (error) {
        console.error("Error al inicializar traslados:", error);
    }
}

function filtrarTablaTraslados() {
    // Capturamos los elementos cada vez que se filtra para asegurar que existen
    const selectAnio = document.getElementById('filtro-traslado-anio');
    const inputBusqueda = document.getElementById('busqueda-traslados');
    const tbody = document.getElementById('body-traslados');

    if (!selectAnio || !inputBusqueda || !tbody) return;

    const anioBusqueda = selectAnio.value;
    const textoBusqueda = inputBusqueda.value.toLowerCase().trim();

    // Lógica de filtrado robusta
    const filtrados = datosTrasladosLocal.filter(t => {
        // Comparación de Año (convertimos ambos a String para evitar fallos)
        const coincideAnio = (anioBusqueda === 'TODOS' || String(t.idAnio) === String(anioBusqueda));
        
        // Comparación de Texto (DNI o Nombre)
        const coincideTexto = String(t.estudiante).toLowerCase().includes(textoBusqueda) || 
                               String(t.dni).includes(textoBusqueda);
                               
        return coincideAnio && coincideTexto;
    });

    // Renderizado de resultados
    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px; color: #94a3b8;">No se encontraron registros con esos criterios.</td></tr>';
        return;
    }

    tbody.innerHTML = filtrados.map(t => {
        const fecha = t.fecha ? new Date(t.fecha).toLocaleDateString() : '---';
        return `
            <tr>
                <td style="color: #64748b; font-size: 0.85rem;">${fecha}</td>
                <td style="font-family: 'Roboto Mono', monospace;">${t.dni}</td>
                <td style="font-weight: 700; color: #1e293b;">${String(t.estudiante).toUpperCase()}</td>
                <td style="text-align:center;">
                    <span class="badge" style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: 800;">TRASLADADO</span>
                </td>
                <td style="font-size: 0.85rem; color: #0369a1;">
                    <i class="material-icons" style="font-size: 14px; vertical-align: middle;">person</i> ${t.usuario}
                </td>
            </tr>
        `;
    }).join('');
}


/*CONCEPTOS DE PAGO------------------*/
let datosConceptosLocal = { secciones: [], anio: null };

function renderConceptosView() {
    if (currentUser.role !== 'ADMINISTRADOR') {
        lanzarNotificacion('error', 'SEGURIDAD', 'Acceso restringido.');
        document.getElementById('content-area').innerHTML = `<div style="text-align:center; padding: 100px;"><i class="material-icons" style="font-size:60px; color:#cbd5e1;">lock</i><h3 style="color:#64748b;">Módulo Administrativo Bloqueado</h3></div>`;
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <style>
            .concepto-label {
                display: block;
                font-weight: 700;
                font-size: 0.95rem !important; /* Reducido de 1.1 */
                color: #475569;
                margin-bottom: 8px;
                margin-left: 4px;
                text-transform: uppercase;
            }
            .concepto-input {
                width: 100%;
                padding: 12px 16px !important; /* Reducido de 16/20 */
                font-size: 1rem !important;    /* Reducido de 1.2 */
                border: 2px solid #e2e8f0 !important;
                border-radius: 12px !important; /* Un poco menos exagerado */
                color: #1e293b;
                transition: all 0.3s ease;
                margin-bottom: 20px;
            }
            .concepto-input:focus {
                border-color: #0ea5e9 !important;
                background-color: #f0f9ff;
            }
            .panel-estilizado {
                background: #f8fafc; 
                border: 1px solid #e2e8f0; 
                border-radius: 18px; 
                padding: 25px; /* Más compacto */
            }
        </style>

        <div class="module-header animate__animated animate__fadeIn" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; width: 100%;">
            <div>
                <h2 style="color: #0369a1; font-weight: 900; font-size: 1.8rem; margin:0;">Configuración de Conceptos</h2>
                <p style="color: #64748b; font-size: 1rem; margin-top: 2px;">Gestione los costos institucionales.</p>
            </div>
            <div class="anio-indicador" style="padding: 8px 20px; border-radius: 30px; background: #0369a1; color: white;">
                <i class="material-icons" style="vertical-align: middle; font-size: 1.2rem;">event_available</i>
                <span id="cp-anio-texto" style="font-weight: 700; font-size: 0.95rem;">CARGANDO...</span>
            </div>
        </div>

        <div class="animate__animated animate__fadeInUp" style="width: 100%; display: grid; grid-template-columns: 1.2fr 1fr; gap: 25px;">
            
            <div class="panel-estilizado">
                <h3 style="color: #0369a1; font-size: 1.3rem; font-weight: 900; margin-bottom: 20px; border-bottom: 3px solid #0ea5e9; padding-bottom: 8px; display: inline-block;">
                    1. DATOS GENERALES
                </h3>
                
                <div style="background: white; padding: 20px; border-radius: 15px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
                    
                    <div style="margin-bottom: 15px;">
                        <label class="concepto-label">Tipo de Concepto</label>
                        <select id="cp-tipo" class="concepto-input" style="font-weight: 700; color: #0369a1;">
                            <option value="REGULAR">REGULAR (Matrícula/Pensión)</option>
                            <option value="ADICIONAL">ADICIONAL (otros)</option>
                            <option value="EXCEPCIONAL">EXCEPCIONAL (No matriculados)</option>
                        </select>
                    </div>

                    <label class="concepto-label">Nombre del Concepto</label>
                    <input type="text" id="cp-nombre" class="concepto-input" placeholder="Ej: MATRÍCULA 2026">

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label class="concepto-label">Monto (S/)</label>
                            <input type="number" id="cp-monto" class="concepto-input" placeholder="0.00" step="0.01" style="font-weight: 800;">
                        </div>
                        <div>
                            <label class="concepto-label">Vencimiento</label>
                            <input type="date" id="cp-fecha" class="concepto-input">
                        </div>
                    </div>
                </div>

                <div style="background: white; padding: 20px; border-radius: 15px; border: 1px solid #e2e8f0;">
                    <label class="concepto-label">Nivel Académico</label>
                    <select id="cp-nivel" class="concepto-input" onchange="actualizarCheckboxesGradosConcepto()" style="font-weight: 700;">
                        <option value="">-- SELECCIONE --</option>
                    </select>
                </div>
            </div>

            <div class="panel-estilizado">
                <h3 style="color: #0369a1; font-size: 1.3rem; font-weight: 900; margin-bottom: 20px; border-bottom: 3px solid #0ea5e9; padding-bottom: 8px; display: inline-block;">
                    2. GRADOS AFECTADOS
                </h3>
                
                <div id="contenedor-grados-cp" style="background: white; border: 1px solid #e2e8f0; border-radius: 15px; padding: 20px; height: 320px; overflow-y: auto;">
                    <div style="text-align: center; margin-top: 100px; color: #94a3b8;">
                        <p style="font-size: 1rem; font-weight: 600;">Seleccione nivel.</p>
                    </div>
                </div>

                <div style="margin-top: 25px; display: flex; justify-content: flex-end;">
                    <button id="btn-save-cp" class="btn-matricula-especial" onclick="procesarGuardadoConcepto()" 
                        style="width: auto; padding: 14px 50px; font-size: 1rem; font-weight: 800; border-radius: 50px;">
                        <i class="material-icons" style="margin-right:10px;">save</i> GUARDAR CONFIGURACIÓN
                    </button>
                </div>
            </div>
        </div>
    `;
    inicializarDatosConceptos();
}

async function inicializarDatosConceptos() {
    try {
        const res = await sendRequest('get_datos_conceptos');
        if (res.status === 'success') {
            datosConceptosLocal = res;
            anioActivoID = res.anio.id;

            // 1. Mostrar el año activo
            document.getElementById('cp-anio-texto').innerText = `AÑO: ${res.anio.nombre}`;

            // 2. Llenar niveles desde las secciones existentes
            const niveles = [...new Set(res.secciones.map(s => s.nivel))];
            const combo = document.getElementById('cp-nivel');
            combo.innerHTML = '<option value="">Seleccione Nivel...</option>' + 
                niveles.map(n => `<option value="${n}">${n}</option>`).join('');
        }
    } catch (e) { console.error(e); }
}

function actualizarCheckboxesGradosConcepto() {
    const nivel = document.getElementById('cp-nivel').value;
    const container = document.getElementById('contenedor-grados-cp');
    
    if (!nivel) {
        container.innerHTML = '<div style="text-align:center; margin-top:100px; color:#94a3b8;"><p>Seleccione un nivel.</p></div>';
        return;
    }

    let grados = [...new Set(datosConceptosLocal.secciones.filter(s => s.nivel === nivel).map(s => s.grado))];

    const ordenValores = {
        "INICIAL 3 AÑOS": 1, "3 AÑOS": 1, "INICIAL 4 AÑOS": 2, "4 AÑOS": 2, "INICIAL 5 AÑOS": 3, "5 AÑOS": 3,
        "PRIMERO": 10, "SEGUNDO": 11, "TERCERO": 12, "CUARTO": 13, "QUINTO": 14, "SEXTO": 15,
        "1°": 10, "2°": 11, "3°": 12, "4°": 13, "5°": 14, "6°": 15
    };

    grados.sort((a, b) => (ordenValores[a.toUpperCase()] || 99) - (ordenValores[b.toUpperCase()] || 99));

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">
            ${grados.map(g => `
                <label style="display: flex; align-items: center; gap: 12px; background: #f8fafc; padding: 12px; border-radius: 12px; border: 2px solid #e2e8f0; cursor: pointer; transition: all 0.2s;">
                    <input type="checkbox" name="grados-cp" value="${g}" style="width: 20px; height: 20px; cursor: pointer; accent-color: #0ea5e9;">
                    <span style="font-weight: 700; color: #1e293b; font-size: 0.95rem;">${g}</span>
                </label>
            `).join('')}
        </div>
    `;

    document.querySelectorAll('#contenedor-grados-cp label').forEach(label => {
        label.onmouseenter = () => { label.style.borderColor = '#0ea5e9'; label.style.background = '#f0f9ff'; };
        label.onmouseleave = () => { label.style.borderColor = '#e2e8f0'; label.style.background = '#f8fafc'; };
    });
}

async function procesarGuardadoConcepto() {
    const btn = document.getElementById('btn-save-cp');
    // Obtenemos los grados seleccionados
    const seleccionados = Array.from(document.querySelectorAll('input[name="grados-cp"]:checked')).map(cb => cb.value);
    
    // --- CORRECCIÓN: Definimos la variable que faltaba ---
    // Buscamos el elemento select. Si no lo encuentras (null), usamos un valor por defecto.
    const selectTipo = document.getElementById('cp-tipo');
    const tipoConcepto = selectTipo ? selectTipo.value : "REGULAR"; 

    // Capturamos el resto de datos
    const data = {
        nombre: document.getElementById('cp-nombre').value.toUpperCase(),
        monto: document.getElementById('cp-monto').value,
        fechaProg: document.getElementById('cp-fecha').value,
        nivel: document.getElementById('cp-nivel').value,
        grados: seleccionados,
        idAnio: anioActivoID,
        tipo: tipoConcepto // Ahora sí existe la variable
    };

    // Validaciones
    if (!data.nombre || !data.monto || seleccionados.length === 0 || !data.tipo) {
        return lanzarNotificacion('error', 'SISTEMA', 'Complete todos los campos requeridos (Nombre, Monto, Tipo y Grados).');
    }

    // Animación de carga
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';
    btn.disabled = true;

    try {
        const res = await sendRequest('save_concepto_pago', data);
        
        if (res.status === 'success') {
            lanzarNotificacion('success', 'ÉXITO', res.message);
            renderConceptosView(); // Recargamos la vista para limpiar
        } else {
            lanzarNotificacion('error', 'ERROR AL GUARDAR', res.message);
        }
    } catch (e) {
        console.error(e);
        lanzarNotificacion('error', 'CONEXIÓN', 'No se pudo conectar con el servidor.');
    } finally {
        // Restauramos el botón
        if (btn) {
            btn.innerHTML = textoOriginal;
            btn.disabled = false;
        }
    }
}

function renderizarCheckboxesGrados() {
    const nivel = document.getElementById('cp-nivel').value;
    const container = document.getElementById('grados-checkbox-container');
    
    if (!nivel) {
        container.innerHTML = '<p class="text-muted" style="text-align:center; margin-top:60px;">Seleccione un nivel.</p>';
        return;
    }

    // Obtenemos grados únicos del nivel seleccionado desde la memoria global
    const grados = [...new Set(seccionesGlobal
        .filter(s => s.nivel === nivel)
        .map(s => s.grado))].sort();

    if (grados.length === 0) {
        container.innerHTML = '<p class="text-danger" style="text-align:center; margin-top:60px;">No hay grados configurados para este nivel.</p>';
        return;
    }

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            ${grados.map(g => `
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 5px; border-radius: 6px; transition: 0.2s;" onmouseover="this.style.background='#e0f2fe'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" name="cp-grado-check" value="${g}" style="width:18px; height:18px;">
                    <span style="font-weight: 600; color: #334155; font-size: 0.9rem;">${g}</span>
                </label>
            `).join('')}
        </div>
    `;
}

function guardarConceptoPago(data, usuarioEmail) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // Seguridad extra: verificar rol en el servidor
  const rol = obtenerRolDesdeExcel(usuarioEmail);
  if (rol !== 'ADMINISTRADOR') {
    return { status: 'error', message: 'No tiene permisos para realizar esta acción.' };
  }

  const sheetConceptos = ss.getSheetByName('ConceptosPago');
  const sheetSecciones = ss.getSheetByName('Secciones');
  const todasSecciones = sheetSecciones.getDataRange().getValues();

  // Filtrar las secciones que corresponden a la combinación de Nivel y Grados elegidos
  const idsSecciones = todasSecciones.slice(1)
    .filter(row => row[1] === data.idAnio && row[2] === data.nivel && data.grados.includes(row[3]))
    .map(row => row[0]);

  const nuevoId = 'CP-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  
  sheetConceptos.appendRow([
    nuevoId,
    data.nombre,
    data.monto,
    data.idAnio,
    data.nivel,
    data.grados.join(', '),
    data.fechaProg,
    new Date(),
    idsSecciones.join(', ')
  ]);

  return { status: 'success', message: 'Concepto configurado y vinculado a ' + idsSecciones.length + ' secciones.' };
}



/*DESCUENTOS-----------------------------------------*/
let datosDescuentosLocal = { estudiantes: [], conceptos: [], anio: null };
let estudianteElegidoDesc = null;

function renderDescuentosView() {
    const rolesAutorizados = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!rolesAutorizados.includes(currentUser.role)) {
        lanzarNotificacion('error', 'SEGURIDAD', 'No tiene permisos para esta sección.');
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <style>
            .desc-label { display: block; font-weight: 700; font-size: 0.95rem; color: #475569; margin-bottom: 8px; text-transform: uppercase; }
            .desc-input { width: 100%; padding: 12px 16px; font-size: 1rem; border: 2px solid #e2e8f0; border-radius: 12px; color: #1e293b; margin-bottom: 20px; transition: 0.3s; }
            .desc-input:focus { border-color: #0ea5e9; outline: none; background: #f0f9ff; }
            .panel-desc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 18px; padding: 25px; }
            .item-est-busqueda { padding: 10px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: 0.2s; }
            .item-est-busqueda:hover { background: #e0f2fe; }
        </style>

        <div class="module-header animate__animated animate__fadeIn" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px;">
            <div>
                <h2 style="color: #0369a1; font-weight: 900; font-size: 1.8rem; margin:0;">Gestión de Descuentos</h2>
                <p style="color: #64748b;">Asigne beneficios económicos a estudiantes matriculados.</p>
            </div>
            <div class="anio-indicador" style="padding: 8px 20px; border-radius: 30px; background: #0369a1; color: white;">
                <i class="material-icons" style="vertical-align: middle; font-size: 1.2rem;">event_available</i>
                <span id="desc-anio-texto" style="font-weight: 700; font-size: 0.95rem;">CARGANDO...</span>
            </div>
        </div>

        <div class="animate__animated animate__fadeInUp" style="width: 100%; display: grid; grid-template-columns: 1.2fr 1fr; gap: 25px;">
            
            <div class="panel-desc">
                <h3 style="color: #0369a1; font-size: 1.3rem; font-weight: 900; margin-bottom: 20px; border-bottom: 3px solid #0ea5e9; padding-bottom: 8px; display: inline-block;">
                    1. ESTUDIANTE Y MONTO
                </h3>

                <div style="background: white; padding: 20px; border-radius: 15px; border: 1px solid #e2e8f0; margin-bottom: 20px; position: relative;"> <label class="desc-label">Buscar Estudiante (DNI o Nombre)</label>
                    <input type="text" id="desc-busqueda" class="desc-input" placeholder="Escriba para buscar..." onkeyup="filtrarEstudiantesDescuento()">
                    
                    <div id="resultados-busqueda-desc" 
                        style="max-height: 200px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 10px; 
                                display: none; position: absolute; width: calc(100% - 40px); z-index: 100; 
                                background: white; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
                    </div>
                    
                    <div id="estudiante-seleccionado-info" style="margin-top: 15px; display: none; background: #f0f9ff; padding: 15px; border-radius: 15px; border-left: 5px solid #0ea5e9;">
                        <div style="font-weight: 800; color: #0369a1;" id="desc-est-nombre">---</div>
                        <div style="font-size: 0.85rem; color: #64748b;" id="desc-est-dni">DNI: ---</div>
                        
                        <div id="historial-estudiante-desc" style="margin-top: 15px; border-top: 1px solid #bae6fd; padding-top: 10px;">
                            <div style="font-weight: 700; font-size: 0.8rem; color: #0369a1; margin-bottom: 5px;">HISTORIAL DE DESCUENTOS (AÑO ACTUAL)</div>
                            <div id="lista-historial-vacia" style="font-size: 0.8rem; color: #94a3b8;">Sin descuentos previos.</div>
                            <div id="tabla-historial-desc" style="display:none;">
                                </div>
                        </div>
                    </div>
                </div>

                <div style="background: white; padding: 20px; border-radius: 15px; border: 1px solid #e2e8f0;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label class="desc-label">Monto Descuento (S/)</label>
                            <input type="number" id="desc-monto" class="desc-input" placeholder="0.00" style="font-weight: 800; color: #dc2626;">
                        </div>
                        <div>
                            <label class="desc-label">Observación (Opcional)</label>
                            <input type="text" id="desc-obs" class="desc-input" placeholder="Motivo...">
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel-desc">
                <h3 style="color: #0369a1; font-size: 1.3rem; font-weight: 900; margin-bottom: 20px; border-bottom: 3px solid #0ea5e9; padding-bottom: 8px; display: inline-block;">
                    2. CONCEPTOS A APLICAR
                </h3>
                
                <div id="contenedor-conceptos-desc" style="background: white; border: 1px solid #e2e8f0; border-radius: 15px; padding: 20px; height: 320px; overflow-y: auto;">
                    <div style="text-align: center; margin-top: 100px; color: #94a3b8;">
                        <p>Seleccione un estudiante para ver los conceptos de su sección.</p>
                    </div>
                </div>

                <div style="margin-top: 25px; display: flex; justify-content: flex-end;">
                    <button id="btn-save-desc" class="btn-matricula-especial" onclick="procesarGuardadoDescuento()" style="width: auto; padding: 14px 50px; font-weight: 800;">
                        <i class="material-icons" style="margin-right:10px;">check_circle</i> REGISTRAR DESCUENTO
                    </button>
                </div>
            </div>
        </div>
    `;
    inicializarDescuentos();
}

async function inicializarDescuentos() {
    try {
        const res = await sendRequest('get_datos_descuentos');
        if (res.status === 'success') {
            datosDescuentosLocal = res;
            anioActivoID = res.anio.id;
            document.getElementById('desc-anio-texto').innerText = `AÑO: ${res.anio.nombre}`;
        }
    } catch (e) { console.error(e); }
}

function filtrarEstudiantesDescuento() {
    const inputBusqueda = document.getElementById('desc-busqueda');
    const listaResultados = document.getElementById('resultados-busqueda-desc');
    
    if (!inputBusqueda || !listaResultados) return;

    const buscado = inputBusqueda.value.toLowerCase().trim();
    
    // Si la búsqueda es muy corta, ocultamos la lista
    if (buscado.length < 2) { 
        listaResultados.style.display = 'none'; 
        return; 
    }

    // Filtrado robusto (Nombre y DNI)
    const filtrados = datosDescuentosLocal.estudiantes.filter(e => {
        const nombreMatch = String(e.nombre).toLowerCase().includes(buscado);
        const dniMatch = String(e.dni).includes(buscado);
        return nombreMatch || dniMatch;
    });

    if (filtrados.length > 0) {
        listaResultados.innerHTML = filtrados.map((e, index) => `
            <div class="item-est-busqueda" 
                 onclick="seleccionarEstudianteDescByIndex(${index}, '${e.idEst}')"
                 style="padding: 12px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer;">
                <div style="font-weight: 700; color: #1e293b;">${e.nombre}</div>
                <div style="font-size: 0.8rem; color: #64748b;">DNI: ${e.dni}</div>
            </div>
        `).join('');
        listaResultados.style.display = 'block';
        // Ajuste de estilo para que flote sobre el resto
        listaResultados.style.position = 'absolute';
        listaResultados.style.zIndex = '100';
        listaResultados.style.width = '100%';
        listaResultados.style.background = 'white';
        listaResultados.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)';
    } else {
        listaResultados.innerHTML = '<div class="p-3 text-muted">No se encontraron estudiantes activos.</div>';
        listaResultados.style.display = 'block';
    }
}

function seleccionarEstudianteDesc(est) {
    estudianteElegidoDesc = est;
    document.getElementById('desc-busqueda').value = est.nombre;
    document.getElementById('resultados-busqueda-desc').style.display = 'none';
    
    // Mostrar info fija
    document.getElementById('estudiante-seleccionado-info').style.display = 'block';
    document.getElementById('desc-est-nombre').innerText = est.nombre;
    document.getElementById('desc-est-dni').innerText = `DNI: ${est.dni}`;

    // Filtrar conceptos de la sección del alumno
    const conceptosAptos = datosDescuentosLocal.conceptos.filter(c => {
        const ids = String(c.idsSecciones).split(',').map(s => s.trim());
        return ids.includes(String(est.idSec));
    });

    const cont = document.getElementById('contenedor-conceptos-desc');
    if (conceptosAptos.length === 0) {
        cont.innerHTML = '<p class="text-danger text-center">No hay conceptos de pago para la sección de este alumno.</p>';
    } else {
        cont.innerHTML = `<div style="display:grid; gap:10px;">
            ${conceptosAptos.map(c => `
                <label style="display: flex; align-items: center; gap: 12px; background: #f8fafc; padding: 12px; border-radius: 12px; border: 2px solid #e2e8f0; cursor: pointer;">
                    <input type="checkbox" name="desc-con-check" value="${c.id}" style="width: 20px; height: 20px; accent-color: #0ea5e9;">
                    <span style="font-weight: 700; color: #334155; font-size: 0.95rem;">${c.nombre} (S/ ${c.monto})</span>
                </label>
            `).join('')}
        </div>`;
    }
}

async function procesarGuardadoDescuento() {
    const btn = document.getElementById('btn-save-desc');
    const seleccionados = Array.from(document.querySelectorAll('input[name="desc-con-check"]:checked')).map(cb => cb.value);
    const monto = document.getElementById('desc-monto').value;
    const observacion = document.getElementById('desc-obs').value;

    if (!estudianteElegidoDesc || seleccionados.length === 0 || !monto) {
        return lanzarNotificacion('error', 'FALTAN DATOS', 'Seleccione al menos un alumno, un concepto y el monto.');
    }

    // Bloqueo estético del botón
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> REGISTRANDO...';
    btn.disabled = true;

    try {
        const res = await sendRequest('save_descuentos_estudiante', {
            idEst: estudianteElegidoDesc.idEst,
            idAnio: anioActivoID,
            monto: monto,
            conceptosIds: seleccionados,
            obs: observacion // Enviamos la observación aunque sea opcional
        });

        if (res.status === 'success') {
            lanzarNotificacion('success', 'ÉXITO', res.message);
            // Limpiar variables y recargar vista
            estudianteElegidoDesc = null;
            renderDescuentosView();
        } else {
            lanzarNotificacion('error', 'SISTEMA', res.message);
        }
    } catch (e) {
        lanzarNotificacion('error', 'CONEXIÓN', 'No se pudo comunicar con el servidor.');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

// Usamos el índice para recuperar el objeto de la memoria local de forma segura
function seleccionarEstudianteDescByIndex(index, idEst) {
    const buscado = document.getElementById('desc-busqueda');
    const lista = document.getElementById('resultados-busqueda-desc');
    const panelInfo = document.getElementById('estudiante-seleccionado-info');
    
    const est = datosDescuentosLocal.estudiantes.find(e => e.idEst === idEst);
    
    if (est) {
        estudianteElegidoDesc = est;
        buscado.value = est.nombre;
        lista.style.display = 'none';
        panelInfo.style.display = 'block';
        document.getElementById('desc-est-nombre').innerText = est.nombre;
        document.getElementById('desc-est-dni').innerText = `DNI: ${est.dni}`;

        // 1. BUSCAR DESCUENTOS PREVIOS DE ESTE ALUMNO
        const misDescuentos = datosDescuentosLocal.descuentos.filter(d => d.idEst === est.idEst);
        const idsConceptosConDescuento = misDescuentos.map(d => d.idCon);

        // 2. RENDERIZAR HISTORIAL EN EL PANEL IZQUIERDO
        const contHistorial = document.getElementById('tabla-historial-desc');
        const msgVacio = document.getElementById('lista-historial-vacia');
        
        if (misDescuentos.length > 0) {
            msgVacio.style.display = 'none';
            contHistorial.style.display = 'block';
            contHistorial.innerHTML = misDescuentos.map(d => `
                <div style="background: white; padding: 6px 10px; border-radius: 8px; margin-bottom: 5px; font-size: 0.8rem; display: flex; justify-content: space-between; border: 1px solid #e0f2fe;">
                    <span style="font-weight: 600;">${d.nombreConcepto}</span>
                    <span style="color: #dc2626; font-weight: 700;">- S/ ${parseFloat(d.monto).toFixed(2)}</span>
                </div>
            `).join('');
        } else {
            msgVacio.style.display = 'block';
            contHistorial.style.display = 'none';
        }

        // 3. FILTRAR CONCEPTOS DISPONIBLES (DERECHA)
        // Regla: Debe ser de su sección Y NO debe tener ya un descuento aplicado
        const conceptosAptos = datosDescuentosLocal.conceptos.filter(c => {
            const seccionesPermitidas = String(c.idsSecciones).split(',').map(s => s.trim());
            const perteneceASeccion = seccionesPermitidas.includes(String(est.idSec));
            const yaTieneDescuento = idsConceptosConDescuento.includes(c.id);
            return perteneceASeccion && !yaTieneDescuento;
        });

        renderizarConceptosDisponibles(conceptosAptos);
    }
}

function renderizarConceptosDisponibles(conceptos) {
    const cont = document.getElementById('contenedor-conceptos-desc');
    
    if (conceptos.length === 0) {
        cont.innerHTML = `
            <div style="text-align:center; padding-top:80px; color:#64748b;">
                <i class="material-icons" style="font-size:40px; opacity:0.5;">check_circle</i>
                <p style="font-weight: 600;">El alumno ya tiene descuentos en todos los conceptos disponibles o su sección no tiene cargos.</p>
            </div>`;
    } else {
        cont.innerHTML = `
            <div style="display:grid; gap:10px;">
                ${conceptos.map(c => `
                    <label style="display: flex; align-items: center; gap: 12px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 2px solid #e2e8f0; cursor: pointer; transition: 0.2s;">
                        <input type="checkbox" name="desc-con-check" value="${c.id}" style="width: 20px; height: 20px; accent-color: #0ea5e9;">
                        <div>
                            <div style="font-weight: 800; color: #1e293b; font-size: 0.95rem;">${c.nombre}</div>
                            <div style="color: #0369a1; font-weight: 700;">S/ ${parseFloat(c.monto).toFixed(2)}</div>
                        </div>
                    </label>
                `).join('')}
            </div>`;
            
        // Aplicar hover dinámico
        document.querySelectorAll('#contenedor-conceptos-desc label').forEach(label => {
            label.onmouseenter = () => label.style.borderColor = '#0ea5e9';
            label.onmouseleave = () => label.style.borderColor = '#e2e8f0';
        });
    }
}

function cargarConceptosParaEstudiante(idSecEstudiante) {
    const cont = document.getElementById('contenedor-conceptos-desc');
    
    // Filtrar conceptos comparando los IDs de secciones (convertidos a String)
    const conceptosAptos = datosDescuentosLocal.conceptos.filter(c => {
        const seccionesPermitidas = String(c.idsSecciones).split(',').map(s => s.trim());
        return seccionesPermitidas.includes(String(idSecEstudiante));
    });

    if (conceptosAptos.length === 0) {
        cont.innerHTML = `
            <div style="text-align:center; padding-top:80px; color:#ef4444;">
                <i class="material-icons">warning</i>
                <p>Esta sección no tiene conceptos de pago vinculados.</p>
            </div>`;
    } else {
        cont.innerHTML = `
            <div style="display:grid; gap:10px;">
                ${conceptosAptos.map(c => `
                    <label style="display: flex; align-items: center; gap: 12px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 2px solid #e2e8f0; cursor: pointer;">
                        <input type="checkbox" name="desc-con-check" value="${c.id}" style="width: 20px; height: 20px; accent-color: #0ea5e9;">
                        <div>
                            <div style="font-weight: 800; color: #1e293b; font-size: 0.95rem;">${c.nombre}</div>
                            <div style="color: #0369a1; font-weight: 700;">S/ ${parseFloat(c.monto).toFixed(2)}</div>
                        </div>
                    </label>
                `).join('')}
            </div>`;
    }
}

/*NUEVO RECIBO-------------------------------------------*/
/* =========================================
   MÓDULO: NUEVO RECIBO - FASE 1 (CORREGIDA)
   ========================================= */
/* --- VARIABLES GLOBALES DEL MÓDULO --- */
let dbRecibo = null;      // Cambiado de {} a null para validación inicial
let borradorRecibo = []; 
let estSelRecibo = null; 

async function inicializarDataRecibo() {
    const res = await sendRequest('get_datos_recibo');
    
    if (res.status === 'success') {
        dbRecibo = res; // Aquí es donde se define la variable para todo el script
        const labelAnio = document.getElementById('rec-anio-txt');
        if (labelAnio) labelAnio.innerText = `AÑO: ${res.anio.nombre}`;
    } else {
        lanzarNotificacion('error', 'DATOS', 'No se pudo obtener la información del servidor.');
    }
}


/* --- MODIFICACIÓN EN renderNuevoReciboView (script.js) --- */

// Variable global para saber en qué pestaña estamos (1=Regular, 2=Adicional, 3=Excepcional)
let pestanaActivaRecibo = 1;

function renderNuevoReciboView() {
    const roles = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!roles.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tiene permisos de tesorería.');
        return;
    }

    const content = document.getElementById('content-area');
    const displayAnio = anioActivoNombre || "SIN AÑO ACTIVO";
    
    content.innerHTML = `
        <div class="module-header animate__animated animate__fadeIn" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px;">
            <div>
                <h2 style="color: #0369a1; font-weight:900; font-size:1.8rem; margin:0;">Nuevo Recibo de Pago</h2>
                <p style="color:var(--text-muted); font-size: 1.1rem; margin-top:5px;">Gestión de cobros por tipo.</p>
            </div>
            <div class="anio-indicador" style="background:var(--sidebar-dark); color:white; padding:12px 30px; border-radius:50px; box-shadow: var(--shadow-md);">
                <i class="material-icons" style="vertical-align:middle; font-size:1.4rem; margin-right:8px;">event_available</i>
                <span style="font-weight:800; font-size: 1rem;">${displayAnio}</span>
            </div>
        </div>

        <div class="tabs-container" style="margin-bottom: 25px;">
            <button class="tab-button active" onclick="cambiarPestanaRecibo(1, this)">
                <i class="material-icons" style="vertical-align:middle; margin-right:5px;">receipt</i> REGULAR
            </button>
            <button class="tab-button" onclick="cambiarPestanaRecibo(2, this)">
                <i class="material-icons" style="vertical-align:middle; margin-right:5px;">library_add</i> ADICIONAL
            </button>
            <button class="tab-button" onclick="cambiarPestanaRecibo(3, this)">
                <i class="material-icons" style="vertical-align:middle; margin-right:5px;">sell</i> EXCEPCIONAL
            </button>
        </div>

        <div class="row animate__animated animate__fadeInUp" style="width:100%; margin:0; gap:35px; display: flex; align-items: flex-start;">
            
            <div class="col-md-5" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:24px; padding:30px; flex: 1.2; box-shadow: var(--shadow-sm);">
                <h3 id="titulo-tipo-recibo" class="modal-sub-header" style="border-bottom:4px solid var(--accent-cyan); display:inline-block; margin-bottom:25px; font-size: 1.4rem;">
                    1. PAGO REGULAR (Matrícula/Pensiones)
                </h3>
                
                <div style="background:white; padding:25px; border-radius:20px; border:1px solid #e2e8f0; margin-bottom:25px; position:relative;">
                    <label id="lbl-buscar-est" class="data-label-outline" style="font-size: 1rem !important;">BUSCAR ESTUDIANTE (MATRICULADO)</label>
                    
                    <div style="position: relative; display: flex; align-items: center;">
                        <i class="material-icons" style="position: absolute; left: 18px; color: var(--primary-blue); font-size: 1.8rem; z-index: 10;">search</i>
                        <input type="text" id="rec-busqueda" class="desc-input" placeholder="Nombre completo o DNI..." 
                               onkeyup="filtrarAlumnosRecibo()" 
                               style="padding-left: 65px !important; width:100%; font-size: 1.2rem !important; padding-top: 12px !important; padding-bottom: 12px !important;">
                        
                        <button id="btn-clear-rec" onclick="limpiarBuscadorRec()" style="display:none; position:absolute; right:15px; border:none; background:none; cursor:pointer; z-index: 11;">
                            <i class="material-icons" style="color:#94a3b8;">cancel</i>
                        </button>
                    </div>

                    <div id="rec-resultados" style="display:none; position:absolute; width:100%; left:0; z-index:2000; background:white; border:1px solid #e2e8f0; border-radius:15px; max-height:250px; overflow-y:auto; box-shadow: var(--shadow-lg); margin-top:8px;"></div>
                    
                    <div id="rec-info-alumno" style="display:none; margin-top:20px; background:var(--light-blue); padding:20px; border-radius:16px; border-left:8px solid var(--primary-blue);">
                        <div id="rec-txt-nombre" style="font-weight:900; color:var(--primary-dark); font-size:1.4rem; margin-bottom: 5px;">---</div>
                        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                            <span id="rec-txt-dni" style="font-size:1.1rem; color:var(--text-muted); font-weight: 700;">---</span>
                            <span style="color: #cbd5e1;">|</span>
                            <div id="rec-txt-ubicacion" style="font-size:1rem; color:var(--primary-dark); font-weight: 800; text-transform: uppercase; background: rgba(255,255,255,0.5); padding: 4px 12px; border-radius: 20px;">---</div>
                        </div>
                        <label class="data-label-outline" style="background: white !important; font-size: 1rem !important;">SELECCIONE CONCEPTO</label>
                        <select id="rec-select-con" class="desc-input" onchange="calcularSaldoRecibo()" style="width: 100%; font-size: 1.2rem !important;"></select>
                    </div>
                </div>

                <div id="rec-panel-montos" style="display:none; background:white; padding:20px; border-radius:20px; border:1px solid #e2e8f0;">
                    <div style="background:#f1f5f9; padding:10px 15px; border-radius:12px; margin-bottom:15px; border:1px dashed #cbd5e1;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="data-label" style="font-size: 1rem;">Descuento:</span>
                            <span id="rec-txt-desc" style="font-weight:800; color:var(--accent-cyan); font-size: 1.1rem;">S/ 0.00</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span class="data-label" style="font-size: 1rem;">Pagos Ant:</span>
                            <span id="rec-txt-ant" style="font-weight:800; color:var(--text-muted); font-size: 1.1rem;">S/ 0.00</span>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 15px; margin-bottom: 20px; align-items: stretch;">
                        <div style="text-align:center; background:#f0f9ff; padding:12px; border-radius:16px; border: 2px solid var(--light-blue); display: flex; flex-direction: column; justify-content: center;">
                            <div id="rec-txt-saldo" style="font-weight:900; color:var(--primary-blue); font-size:2rem; letter-spacing: -1px;">S/ 0.00</div>
                            <div style="font-size:0.85rem; font-weight:800; color:var(--primary-dark); text-transform:uppercase;">Saldo Pendiente</div>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <div>
                                <label class="data-label-outline" style="font-size: 0.9rem !important; margin-bottom: 4px !important;">EFECTIVO</label>
                                <input type="number" id="rec-in-efectivo" class="desc-input" placeholder="0.00" onkeyup="validarMontosRecibo()" style="color:#059669; font-weight: 800; text-align: center; font-size: 1.6rem !important; padding: 10px !important;">
                            </div>
                            <div>
                                <label class="data-label-outline" style="font-size: 0.9rem !important; margin-bottom: 4px !important;">DIGITAL</label>
                                <input type="number" id="rec-in-digital" class="desc-input" placeholder="0.00" onkeyup="validarMontosRecibo()" style="color:var(--primary-blue); font-weight: 800; text-align: center; font-size: 1.6rem !important; padding: 10px !important;">
                            </div>
                        </div>
                    </div>
                    
                    <button class="btn-primary" style="width:100%; border-radius:50px; height:60px; font-size: 1.2rem; font-weight: 800;" onclick="agregarItemBorrador()">
                        <i class="material-icons" style="vertical-align: middle; margin-right: 10px;">post_add</i> AÑADIR AL RECIBO
                    </button>
                </div>
            </div>

            <div class="col-md-6" id="rec-panel-derecho" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:24px; padding:30px; flex: 1; display: flex; flex-direction: column;">
                <h3 class="modal-sub-header" style="border-bottom:4px solid var(--accent-cyan); display:inline-block; margin-bottom:25px; font-size: 1.4rem;">2. RESUMEN DEL RECIBO</h3>
                
                <div id="rec-lista-borrador" style="background:white; border-radius:20px; padding:20px; border:1px solid #e2e8f0; overflow-y:auto; min-height:100px; height: auto;">
                    <div id="placeholder-vacio" style="text-align:center; padding: 40px 0; color:var(--text-muted); opacity:0.6;">
                        <i class="material-icons" style="font-size:4rem;">receipt_long</i>
                        <p style="font-size: 1.1rem; font-weight: 600;">Los cobros aparecerán aquí.</p>
                    </div>
                </div>

                <div id="rec-footer-final" style="display:none; margin-top:25px; border-top:3px solid #e2e8f0; padding-top:25px;">
                    <div id="rec-datos-digital" style="display:none; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px; background:#fff7ed; padding:15px; border-radius:16px; border:1px solid #fed7aa;">
                        <div>
                            <label class="data-label-outline" style="font-size: 0.9rem !important;">MEDIO DIGITAL</label>
                            <select id="rec-medio" class="custom-select select-compact">
                                <option value="" selected disabled>--- Seleccione Medio ---</option>
                                <option value="YAPE">YAPE</option><option value="PLIN">PLIN</option>
                                <option value="TRANSFERENCIA">TRANSFERENCIA</option><option value="TARJETA">TARJETA / POS</option>
                            </select>
                        </div>
                        <div>
                            <label class="data-label-outline" style="font-size: 0.9rem !important;">CÓD. OPERACIÓN</label>
                            <input type="text" id="rec-cod" class="desc-input" placeholder="Cód. Op." style="width: 100%; font-size: 1.2rem !important; height: 50px !important;">
                        </div>
                    </div>

                    <label class="data-label-outline" style="font-size: 1rem !important;">OBSERVACIONES</label>
                    <input type="text" id="rec-obs" class="desc-input" placeholder="Opcional..." style="margin-bottom:20px; width: 100%; font-size: 1.1rem !important;">

                    <div style="display:flex; justify-content:space-between; align-items:center; background: white; padding: 15px 20px; border-radius: 18px; border: 1px solid #e2e8f0;">
                        <div style="font-size:1.5rem; font-weight:900; color:var(--text-main);">
                            TOTAL: <span id="rec-lbl-total" style="color:var(--primary-blue); font-size: 2rem;">S/ 0.00</span>
                        </div>
                        <button id="btn-save-rec" class="btn-matricula-especial" style="width:auto; padding:12px 25px; font-size: 1.3rem; white-space: nowrap; margin-left: 20px;" onclick="enviarProcesarRecibo()">
                            <i class="material-icons" style="vertical-align: middle; margin-right: 8px; font-size: 1.6rem;">check_circle</i> GENERAR
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Por defecto, iniciamos en la pestaña 1
    pestanaActivaRecibo = 1;
    inicializarDataRecibo();
}

function cambiarPestanaRecibo(n, btn) {
    pestanaActivaRecibo = n;

    // 1. Visual: Actualizar botones activos
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 2. Visual: Cambiar Textos según la pestaña
    const titulo = document.getElementById('titulo-tipo-recibo');
    const lblBuscar = document.getElementById('lbl-buscar-est');

    if (n === 1) {
        titulo.innerText = "1. PAGO REGULAR (Pensiones)";
        lblBuscar.innerText = "BUSCAR ESTUDIANTE (MATRICULADO)";
    } else if (n === 2) {
        titulo.innerText = "1. PAGO ADICIONAL (Talleres/Materiales)";
        lblBuscar.innerText = "BUSCAR ESTUDIANTE (MATRICULADO)";
    } else {
        titulo.innerText = "1. PAGO EXCEPCIONAL (Multas/Otros)";
        lblBuscar.innerText = "BUSCAR TODOS (INCLUYE NO MATRICULADOS)";
    }

    // 3. Limpieza: Borrar búsqueda anterior para evitar mezclas
    limpiarBuscadorRec();
    
    // Ocultar paneles si había alguno abierto
    document.getElementById('rec-info-alumno').style.display = 'none';
    document.getElementById('rec-panel-montos').style.display = 'none';
    estSelRecibo = null;
}

/**
 * Filtra la lista de alumnos cargada en dbRecibo.alumnos
 */
function filtrarAlumnosRecibo() {
    // --- 1. BLOQUEO DE SEGURIDAD (La Solución) ---
    // Si dbRecibo es null, significa que la carga inicial no ha terminado.
    if (!dbRecibo) {
        console.warn("⏳ Esperando datos de Caja...");
        return; // Detenemos la función para que no explote
    }
    // ---------------------------------------------

    const input = document.getElementById('rec-busqueda');
    const resDiv = document.getElementById('rec-resultados');
    const btnClean = document.getElementById('btn-clear-rec');
    
    // Validación extra: Si el input no existe en el DOM, salimos
    if (!input || !resDiv) return;

    const bus = input.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    if (btnClean) {
        btnClean.style.display = bus.length > 0 ? 'block' : 'none';
    }

    if (bus.length < 2) { 
        resDiv.style.display = 'none'; 
        return; 
    }

    // Selección de la fuente de datos con seguridad
    let fuenteDatos = [];
    
    // Verificamos si la variable pestanaActivaRecibo está definida, si no, asumimos 1 (Regular)
    const pestanaActual = (typeof pestanaActivaRecibo !== 'undefined') ? pestanaActivaRecibo : 1;

    if (pestanaActual === 3) {
        // Pestaña 3: Busca en TODOS (validamos que exista el array)
        fuenteDatos = dbRecibo.todosEstudiantes || []; 
    } else {
        // Pestaña 1 y 2: Busca solo en MATRICULADOS (validamos que exista el array)
        fuenteDatos = dbRecibo.alumnos || [];
    }

    const filtrados = fuenteDatos.filter(a => {
        const nom = (a.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const dni = String(a.dni || ""); 
        return nom.includes(bus) || dni.includes(bus);
    });

    if (filtrados.length > 0) {
        // NOTA: Usar JSON.stringify en onclick puede dar problemas con comillas simples en nombres (ej: O'Connor).
        // Es mejor reemplazar las comillas simples por su entidad HTML si las hubiera.
        resDiv.innerHTML = filtrados.map(a => {
            const safeObj = JSON.stringify(a).replace(/'/g, "&#39;"); 
            return `
            <div onclick='seleccionarAlumnoRec(${safeObj})' 
                 style="padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: 0.2s;"
                 onmouseover="this.style.background='#e0f2fe'" 
                 onmouseout="this.style.background='white'">
                <div style="font-weight: 700; color: #1e293b;">${a.nombre}</div>
                <div style="font-size: 0.8rem; color: #64748b;">
                    DNI: ${a.dni} ${a.secNom ? `| ${a.secNom}` : ''}
                </div>
            </div>
        `}).join('');
        resDiv.style.display = 'block';
    } else {
        resDiv.innerHTML = '<div style="padding:15px; color:#94a3b8;">Sin resultados.</div>';
        resDiv.style.display = 'block';
    }
}

/**
 * Limpia el cuadro de búsqueda
 */
function limpiarBuscadorRec() {
    const input = document.getElementById('rec-busqueda');
    input.value = "";
    document.getElementById('rec-resultados').style.display = 'none';
    document.getElementById('btn-clear-rec').style.display = 'none';
    input.focus();
}


/**
 * Ejecuta la selección del alumno y prepara el formulario
 */
// Asegúrate de que estas variables estén al inicio de tu sección de Nuevo Recibo
function seleccionarAlumnoRec(alumno) {
    estSelRecibo = alumno; 
    
    // UI Básica
    const inputBusqueda = document.getElementById('rec-busqueda');
    const divResultados = document.getElementById('rec-resultados');
    const infoAlumno = document.getElementById('rec-info-alumno');
    const selectCon = document.getElementById('rec-select-con');

    inputBusqueda.value = alumno.nombre;
    divResultados.style.display = 'none';
    infoAlumno.style.display = 'block';
    
    document.getElementById('rec-txt-nombre').innerText = alumno.nombre;
    document.getElementById('rec-txt-dni').innerText = `DNI: ${alumno.dni}`;
    
    // Manejo de ubicación (En Tab 3 puede venir sin sección)
    const ubicacion = alumno.secNom 
        ? `${alumno.nivel} - ${alumno.grado} "${alumno.secNom}"`
        : "SIN MATRÍCULA ACTIVA";
    document.getElementById('rec-txt-ubicacion').innerText = ubicacion;


    // --- LÓGICA DE FILTRADO DE CONCEPTOS ---
    let conceptosCandidatos = [];

    if (pestanaActivaRecibo === 1) {
        // TAB 1 (REGULAR): Filtrar por sección del alumno + Tipo REGULAR
        conceptosCandidatos = dbRecibo.conceptos.filter(c => 
            c.tipo === 'REGULAR' &&
            String(c.idsSecciones).split(',').map(s => s.trim()).includes(String(alumno.idSec))
        );
    } else if (pestanaActivaRecibo === 2) {
        // TAB 2 (ADICIONAL): Filtrar por sección del alumno + Tipo ADICIONAL
        conceptosCandidatos = dbRecibo.conceptos.filter(c => 
            c.tipo === 'ADICIONAL' &&
            String(c.idsSecciones).split(',').map(s => s.trim()).includes(String(alumno.idSec))
        );
    } else {
        // TAB 3 (EXCEPCIONAL): Todos los conceptos tipo EXCEPCIONAL (Sin importar sección)
        conceptosCandidatos = dbRecibo.conceptos.filter(c => c.tipo === 'EXCEPCIONAL');
    }

    // --- LÓGICA DE VISUALIZACIÓN EN EL SELECT ---
    
    // CASO TAB 1: Mantener lógica original (Auto-detectar deuda pendiente)
    if (pestanaActivaRecibo === 1) {
        let conceptoAMostrar = null;
        let mensajeBloqueo = "";

        for (let con of conceptosCandidatos) {
            const desc = dbRecibo.descuentos
                .filter(d => d.idEst === alumno.idEst && d.idCon === con.id)
                .reduce((sum, d) => sum + parseFloat(d.monto), 0);
            
            const pagadoHist = dbRecibo.pagosPrevios
                .filter(p => p.idEst === alumno.idEst && p.idCon === con.id)
                .reduce((sum, p) => sum + parseFloat(p.total), 0);

            const pagadoBorrador = borradorRecibo
                .filter(it => it.idEst === alumno.idEst && it.idCon === con.id)
                .reduce((sum, it) => sum + it.totalInd, 0);

            const saldoRestante = parseFloat(con.monto) - desc - pagadoHist - pagadoBorrador;

            if (saldoRestante > 0.01) {
                if (pagadoBorrador > 0) mensajeBloqueo = "Concepto ya añadido al borrador.";
                conceptoAMostrar = con;
                break; // Prioridad cronológica
            }
        }

        selectCon.disabled = false;
        if (mensajeBloqueo !== "") {
            selectCon.innerHTML = `<option value="">-- ${mensajeBloqueo} --</option>`;
            selectCon.disabled = true;
            document.getElementById('rec-panel-montos').style.display = 'none';
        } else if (conceptoAMostrar) {
            selectCon.innerHTML = `
                <option value="">-- Seleccionar concepto pendiente --</option>
                <option value="${conceptoAMostrar.id}" selected>${conceptoAMostrar.nombre}</option>
            `;
            // Auto-calcular si hay uno seleccionado
            calcularSaldoRecibo();
        } else {
            selectCon.innerHTML = '<option value="">Sin deudas regulares pendientes</option>';
            selectCon.disabled = true;
            document.getElementById('rec-panel-montos').style.display = 'none';
        }
    
    } else {
        // CASO TAB 2 y 3: Mostrar LISTA COMPLETA para elegir manualmente
        if (conceptosCandidatos.length > 0) {
            selectCon.innerHTML = '<option value="">-- Seleccione Concepto --</option>' + 
                conceptosCandidatos.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
            selectCon.disabled = false;
        } else {
            selectCon.innerHTML = '<option value="">No hay conceptos disponibles</option>';
            selectCon.disabled = true;
        }
        // Ocultamos el panel de montos hasta que el usuario elija algo
        document.getElementById('rec-panel-montos').style.display = 'none';
    }
}


/**
 * Calcula el saldo real: Costo - Descuento - Pagos Anteriores
 */
function calcularSaldoRecibo() {
    const idCon = document.getElementById('rec-select-con').value;
    const panelMontos = document.getElementById('rec-panel-montos');

    if (!idCon || !estSelRecibo) {
        if (panelMontos) panelMontos.style.display = 'none';
        return;
    }

    const con = dbRecibo.conceptos.find(c => c.id === idCon);
    const costoBase = parseFloat(con.monto);

    // --- CÁLCULOS GENERALES ---
    const montoDescuento = dbRecibo.descuentos
        .filter(d => d.idEst === estSelRecibo.idEst && d.idCon === idCon)
        .reduce((sum, d) => sum + parseFloat(d.monto), 0);
    
    const pagadoAnterior = dbRecibo.pagosPrevios
        .filter(p => p.idEst === estSelRecibo.idEst && p.idCon === idCon)
        .reduce((sum, p) => sum + parseFloat(p.total), 0);

    const saldoFinal = costoBase - montoDescuento - pagadoAnterior;
    
    // Guardamos datos en el objeto del alumno seleccionado
    estSelRecibo.idConActual = idCon;
    estSelRecibo.nomConActual = con.nombre;
    
    // --- NUEVO: Guardamos el TIPO de concepto para usarlo al imprimir ---
    estSelRecibo.tipoConActual = con.tipo || 'REGULAR'; 
    // -------------------------------------------------------------------

    // --- NUEVO: AQUÍ CAPTURAMOS LA FECHA PROGRAMADA ---
    // Asegúrate de que tu backend esté enviando esta propiedad 'fecha' o 'fechaProg'
    estSelRecibo.fechaProg = con.fechaProg || con.fecha || null; 
    // --------------------------------------------------

    const divInfoExtra = panelMontos.querySelector('div:first-child');
    const lblTituloSaldo = document.querySelector('#rec-txt-saldo').nextElementSibling;
    const txtSaldo = document.getElementById('rec-txt-saldo');

    if (pestanaActivaRecibo === 3) { // EXCEPCIONAL
        divInfoExtra.style.display = 'none';
        txtSaldo.innerText = `S/ ${costoBase.toFixed(2)}`;
        lblTituloSaldo.innerText = "IMPORTE / COSTO";
        estSelRecibo.saldoPendiente = costoBase; 
    } else { // REGULAR / ADICIONAL
        divInfoExtra.style.display = 'block';
        document.getElementById('rec-txt-desc').innerText = `S/ ${montoDescuento.toFixed(2)}`;
        document.getElementById('rec-txt-ant').innerText = `S/ ${pagadoAnterior.toFixed(2)}`;
        txtSaldo.innerText = `S/ ${saldoFinal.toFixed(2)}`;
        lblTituloSaldo.innerText = "SALDO PENDIENTE";
        estSelRecibo.saldoPendiente = saldoFinal;
    }
    
    if (panelMontos) panelMontos.style.display = 'block';

    document.getElementById('rec-in-efectivo').value = "";
    document.getElementById('rec-in-digital').value = "";
}


/**
 * Valida que la suma de efectivo + digital no supere el saldo
 */
function validarMontosRecibo() {
    const efec = parseFloat(document.getElementById('rec-in-efectivo').value) || 0;
    const digi = parseFloat(document.getElementById('rec-in-digital').value) || 0;
    const totalIngresado = efec + digi;

    const lblSaldo = document.getElementById('rec-txt-saldo');

    // Si estamos en EXCEPCIONAL (Tab 3), NO validamos que se pase del saldo.
    // Permitimos ingresar cualquier monto.
    if (pestanaActivaRecibo === 3) {
        lblSaldo.style.color = 'var(--primary-blue)';
        return true;
    }

    // Para REGULAR y ADICIONAL, mantenemos la protección contra sobrepagos
    if (totalIngresado > (estSelRecibo.saldoPendiente + 0.01)) {
        lanzarNotificacion('warning', 'MONTO EXCEDIDO', 'La suma supera el saldo pendiente.');
        lblSaldo.style.color = '#ef4444'; // Rojo error
        return false;
    } else {
        lblSaldo.style.color = 'var(--primary-blue)';
        return true;
    }
}

// Vinculamos la validación a los inputs en el HTML (Actualiza tu renderNuevoReciboView)
// Cambia las líneas de los inputs por estas:
// <input type="number" id="rec-in-efectivo" class="desc-input" value="0.00" onkeyup="validarMontosRecibo()">
// <input type="number" id="rec-in-digital" class="desc-input" value="0.00" onkeyup="validarMontosRecibo()">


/**
 * Añade el cobro actual a la lista del borrador
 */
function agregarItemBorrador() {
    if (!estSelRecibo || !validarMontosRecibo()) return;

    const efec = parseFloat(document.getElementById('rec-in-efectivo').value) || 0;
    const digi = parseFloat(document.getElementById('rec-in-digital').value) || 0;
    const total = efec + digi;

    if (total <= 0) return;

    let saldoAGuardar = 0;
    if (typeof pestanaActivaRecibo !== 'undefined' && pestanaActivaRecibo === 3) {
        saldoAGuardar = 0; 
    } else {
        saldoAGuardar = parseFloat(estSelRecibo.saldoPendiente || 0);
    }

    borradorRecibo.push({
        idEst: estSelRecibo.idEst,
        nombre: estSelRecibo.nombre,
        idCon: estSelRecibo.idConActual,
        nomCon: estSelRecibo.nomConActual,
        tipo: estSelRecibo.tipoConActual,

        efectivo: efec,
        digital: digi,
        totalInd: total,
        
        // --- CORRECCIÓN AQUÍ ---
        // Tomamos la fecha del objeto seleccionado actualmente
        fechaProg: estSelRecibo.fechaProg || null, 
        // -----------------------

        saldoPrevio: saldoAGuardar
    });

    actualizarVistaBorrador();

    limpiarBuscadorRec();
    document.getElementById('rec-info-alumno').style.display = 'none';
    document.getElementById('rec-panel-montos').style.display = 'none';
    estSelRecibo = null; 
}

/**
 * Dibuja los elementos del carrito y calcula el total general
 */
/**
 * Dibuja los elementos del borrador y bloquea la eliminación de ítems previos
 */
function actualizarVistaBorrador() {
    const cont = document.getElementById('rec-lista-borrador');
    const placeholder = document.getElementById('placeholder-vacio');
    
    if (borradorRecibo.length === 0) {
        if (placeholder) placeholder.style.display = 'block';
        cont.innerHTML = ''; 
        document.getElementById('rec-footer-final').style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';

    // Generar la lista visual
    cont.innerHTML = borradorRecibo.map((it, idx) => {
        // --- LÓGICA DE BLOQUEO ---
        const esUltimo = idx === borradorRecibo.length - 1;
        const estiloBoton = esUltimo 
            ? 'color: #ef4444; cursor: pointer; opacity: 1;' 
            : 'color: #cbd5e1; cursor: not-allowed; opacity: 0.5;';
        const accionBoton = esUltimo 
            ? `onclick="borrarItemBorrador(${idx})"` 
            : '';
        const tituloBoton = esUltimo 
            ? 'Eliminar cobro' 
            : 'Solo puede eliminar el último ítem agregado';

        return `
            <div class="animate__animated animate__fadeInLeft" style="background:#f8fafc; border-radius:12px; padding:15px; margin-bottom:10px; border-left:5px solid ${esUltimo ? 'var(--primary-blue)' : '#cbd5e1'}; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:800; color:${esUltimo ? 'var(--text-main)' : '#94a3b8'}; font-size:0.95rem;">${it.nombre}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); font-weight:700;">${it.nomCon}</div>
                    <div style="font-size:0.75rem; color:var(--primary-blue); font-weight:800;">
                        Ef: S/ ${it.efectivo.toFixed(2)} | Dg: S/ ${it.digital.toFixed(2)}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:900; color:${esUltimo ? 'var(--text-main)' : '#94a3b8'}; font-size:1.1rem;">S/ ${it.totalInd.toFixed(2)}</div>
                    <button ${accionBoton} title="${tituloBoton}" style="background:none; border:none; ${estiloBoton} transition: 0.3s;">
                        <i class="material-icons" style="font-size:1.4rem;">${esUltimo ? 'delete_forever' : 'lock_outline'}</i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Totales y validación digital
    const granTotal = borradorRecibo.reduce((sum, item) => sum + item.totalInd, 0);
    const tieneDigital = borradorRecibo.some(item => item.digital > 0);

    document.getElementById('rec-lbl-total').innerText = `S/ ${granTotal.toFixed(2)}`;
    document.getElementById('rec-footer-final').style.display = 'block';
    document.getElementById('rec-datos-digital').style.display = tieneDigital ? 'grid' : 'none';
}

function borrarItemBorrador(index) {
    borradorRecibo.splice(index, 1);
    actualizarVistaBorrador();
}


/**
 * Envía el borrador al servidor para generar el recibo oficial
 */
async function enviarProcesarRecibo() {
    // 1. Validaciones previas
    const tieneDigital = borradorRecibo.some(it => it.digital > 0);
    const codOp = document.getElementById('rec-cod').value.trim();
    const medioDig = document.getElementById('rec-medio').value;
    const obs = document.getElementById('rec-obs').value.trim();

    if (tieneDigital && !codOp) {
        return lanzarNotificacion('error', 'FALTA DATOS', 'Debe ingresar el Código de Operación para pagos digitales.');
    }

    if (borradorRecibo.length === 0) {
        return lanzarNotificacion('error', 'VACÍO', 'No hay ítems en el recibo.');
    }

    // 2. Bloqueo visual del botón para evitar doble clic
    const btn = document.getElementById('btn-save-rec');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> PROCESANDO...';

    // 3. Petición al Servidor
    const res = await sendRequest('save_recibo', {
        idAnio: dbRecibo.anio.id,
        items: borradorRecibo,
        medioDigital: tieneDigital ? medioDig : '',
        codOp: tieneDigital ? codOp : '',
        obs: obs
    });

    // 4. Manejo de Respuesta
    if (res.status === 'success') {
        // 1. Notificación silenciosa de éxito en la base de datos
        console.log(`Recibo N° ${res.nroRecibo} guardado.`);

        // 2. Preparamos los datos para la acción posterior
        const copiaBorrador = JSON.parse(JSON.stringify(borradorRecibo));
        const mDig = tieneDigital ? medioDig : "";
        const cOp = tieneDigital ? codOp : "";
        
        // 3. NUEVA FUNCIÓN DE ELECCIÓN
        preguntarAccionRecibo(res.nroRecibo, copiaBorrador, mDig, cOp, obs);

        // 4. Limpieza de la interfaz (igual que antes)
        borradorRecibo = [];
        estSelRecibo = null;
        renderNuevoReciboView();
    } else {
        lanzarNotificacion('error', 'ERROR', res.message);

        //Si el error es por código duplicado, limpiamos el input
        const inputCod = document.getElementById('rec-cod');
        if (inputCod) {
            inputCod.value = ''; // Borra el código rechazado
            inputCod.focus();    // Pone el cursor ahí para que escriba el nuevo
        }

        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}


function preguntarAccionRecibo(nro, datos, medio, cod, obs) {
    // Usamos el sistema de notificaciones que ya tienes para mostrar la elección
    // Nota: Ajusta 'lanzarNotificacion' si tu sistema no permite inyectar HTML complejo, 
    // de lo contrario, usa un SweetAlert o un div flotante.
    
    const areaNotif = document.getElementById('notification-area'); // O el ID de tu contenedor de avisos
    
    const htmlEleccion = `
        <div id="modal-eleccion-recibo" style="background: white; padding: 20px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); text-align: center; border-top: 5px solid #2563eb;">
            <i class="material-icons" style="font-size: 40px; color: #10b981;">check_circle</i>
            <h3 style="margin: 10px 0;">¡Recibo Generado!</h3>
            <p>¿Qué desea hacer con el <b>N° ${nro}</b>?</p>
            
            <div class="choice-container">
                <button class="btn-choice btn-print" id="opt-imprimir">
                    <i class="material-icons">print</i> IMPRIMIR
                </button>
                <button class="btn-choice btn-pdf" id="opt-pdf">
                    <i class="material-icons">picture_as_pdf</i> DESCARGAR
                </button>
            </div>
            
            <button onclick="this.parentElement.parentElement.remove()" style="margin-top:15px; background:none; border:none; color:#64748b; cursor:pointer; text-decoration:underline;">Cerrar sin acciones</button>
        </div>
    `;

    // Mostramos el modal (puedes adaptarlo a tu función lanzarNotificacion)
    const overlay = document.createElement('div');
    overlay.id = "overlay-eleccion";
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999;";
    overlay.innerHTML = htmlEleccion;
    document.body.appendChild(overlay);

    // ASIGNAR EVENTOS A LOS BOTONES
    document.getElementById('opt-imprimir').onclick = () => {
        imprimirTicket(nro, datos, medio, cod, obs);
        document.body.removeChild(overlay);
    };

    document.getElementById('opt-pdf').onclick = () => {
        descargarTicketPDF(datos, nro);
        document.body.removeChild(overlay);
    };
}

/*------------------------------------------------------------------*/
/*IMPRIMIR RECIBO------------------------------*/
/* --- ACTUALIZAR EN SCRIPT.JS --- */

function imprimirTicket(nroRecibo, datosBorrador, medioDigital, codOp, obs) {
    const fechaActual = new Date();
    const fechaStr = fechaActual.toLocaleString('es-PE');
    const logoUrl = 'https://i.postimg.cc/W45SpCYb/insignia-azul-sello.png';
    const granTotal = datosBorrador.reduce((sum, it) => sum + it.totalInd, 0);

    // Iframe invisible
    let iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    let ticketHTML = `
    <html>
    <head>
        <title>Recibo ${nroRecibo}</title>
        <style>
            @page { margin: 0; }
            body { 
                width: 58mm; 
                font-family: 'Courier New', Courier, monospace; 
                font-size: 9pt; 
                margin: 0;
                padding: 10px 5px;
                color: #000;
            }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .line { border-bottom: 1px dashed #000; margin: 6px 0; }
            .item { margin-bottom: 10px; }
            .total-box { margin-top: 10px; font-size: 11pt; border: 1px solid #000; padding: 5px; }
            img { filter: grayscale(1); }
        </style>
    </head>
    <body>
        <div class="center">
            <img src="${logoUrl}" width="65"><br>
            <span class="bold" style="font-size: 10pt;">I.E.P. Ciencias Aplicadas Sir Isaac Newton</span><br>
            <span class="bold">RUC: 20455855226</span><br>
            <span style="font-size: 7.5pt;">Calle Aurelio de la Fuente N° 102-104 - Mollendo</span><br>
            <div class="line"></div>
            <span class="bold" style="font-size: 11pt;">RECIBO N° ${nroRecibo}</span><br>
            <span>${fechaStr}</span>
        </div>
        <div class="line"></div>
        <div class="bold" style="margin-bottom:8px;">DETALLE DE PAGO:</div>
    `;

    datosBorrador.forEach((it, idx) => {
        const saldoRestante = (it.saldoPrevio || 0) - it.totalInd; 
        
        // --- NUEVA LÓGICA DE ESTADO (Retraso vs Puntual) ---
        let bloqueEstado = "";

        // Solo calculamos si el ítem tiene una fecha programada válida
        if (it.fechaProg) {
            const fechaProg = new Date(it.fechaProg);
            const hoy = new Date();
            
            // Ajustamos a medianoche para comparar solo días, ignorando horas
            hoy.setHours(0,0,0,0);
            fechaProg.setHours(0,0,0,0);
            
            // Verificamos que sea una fecha válida antes de calcular
            if (!isNaN(fechaProg.getTime())) {
                const diffTime = hoy - fechaProg;
                // Convertimos milisegundos a días
                const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diasAtraso > 0) {
                    // CASO: MOROSO
                    bloqueEstado = `<div style="font-size: 8pt; font-weight:bold; margin-top:2px;">Días de retraso: ${diasAtraso}</div>`;
                } else {
                    // CASO: PUNTUAL (0 o negativo)
                    bloqueEstado = `<div style="font-size: 8pt; font-style:italic; margin-top:2px;">Pago puntual.</div>`;
                }
            }
        }
        // ----------------------------------------------------

        // Saldo pendiente (Oculto si es pago Excepcional)
        const bloqueSaldo = (it.tipo !== 'EXCEPCIONAL') ? `
            <div style="font-size: 8pt; margin-top: 2px;">
                SALDO PENDIENTE: S/ ${saldoRestante.toFixed(2)}
            </div>` : '';

        ticketHTML += `
        <div class="item">
            <div class="bold">${idx + 1}. ${it.nombre}</div>
            <div style="padding-left: 3px; font-size: 8.5pt;">
                > ${it.nomCon}<br>
                <span>Pagado: S/ ${it.totalInd.toFixed(2)}</span><br>
                <div style="border-left: 2px solid #000; padding-left: 4px; margin-top:2px;">
                   ${bloqueSaldo}
                   ${bloqueEstado} </div>
            </div>
        </div>`;
    });

    ticketHTML += `
        <div class="line" style="border-bottom-style: double;"></div>
        <div class="center total-box bold">
            TOTAL RECIBO: S/ ${granTotal.toFixed(2)}
        </div>
    `;

    if (medioDigital && medioDigital.trim() !== "") {
        ticketHTML += `
        <div style="margin-top: 12px; font-size: 8pt; background: #eee; padding: 4px;">
            <span class="bold">M. DIGITAL:</span> ${medioDigital}<br>
            <span class="bold">CÓD. OP:</span> ${codOp}
        </div>`;
    }

    if (obs) {
        ticketHTML += `<div style="margin-top: 8px; font-size: 7.5pt;"><b>OBS:</b> ${obs}</div>`;
    }

    ticketHTML += `
        <div class="line"></div>
        <div class="center" style="font-size: 8.5pt; margin-top: 15px;">
            ***Gracias por su compromiso y responsabilidad.***<br>
            <span style="font-size: 7pt;">Este es un comprobante interno de pago.</span>
        </div>
        <div style="height: 30px;"></div>
    </body>
    </html>`;

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(ticketHTML);
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
        iframe.contentWindow.print();
    }, 1000);
}


/*--------------------------------------------------------------------------*/
//BUSCAR RECIBOS
function renderRecibosView() {
    const content = document.getElementById('content-area');
    content.innerHTML = `
        <style>
            /* Placeholder más transparente y resaltado celeste */
            .bus-compacto::placeholder { color: rgba(148, 163, 184, 0.4); }
            .bus-compacto:focus { 
                border-color: #7dd3fc !important; 
                box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.2) !important;
                outline: none;
            }
        </style>

        <div class="module-header animate__animated animate__fadeIn" style="margin-bottom: 20px;">
            <h2 style="color: #0369a1; font-weight:900; font-size:1.8rem; margin:0;">Buscador de Recibos</h2>
            <p style="color:var(--text-muted); font-size: 1rem; margin-top:2px;">Consulta y reimpresión de comprobantes.</p>
        </div>

        <div class="card-busqueda" style="background:white; padding:15px 25px; border-radius:18px; border:1px solid #e2e8f0; margin-bottom:20px; max-width:550px; box-shadow: var(--shadow-sm);">
            <label class="data-label-outline" style="font-size:0.85rem !important; margin-bottom: 8px !important;">NÚMERO DE RECIBO</label>
            <div style="display:flex; gap:12px; align-items:center;">
                <input type="text" id="bus-nro-recibo" class="desc-input bus-compacto" 
                       placeholder="Ej: 000125..." 
                       onkeyup="if(event.key==='Enter') buscarReciboFinal()"
                       style="font-size:1.2rem !important; font-weight:700; color:var(--primary-blue); height:45px !important; padding: 0 15px !important;">
                
                <button class="btn-primary" onclick="buscarReciboFinal()" style="height:45px; width:auto; padding:0 20px; font-size:0.95rem; border-radius:12px;">
                    <i class="material-icons" style="font-size:1.2rem; margin-right:5px;">search</i> BUSCAR
                </button>
            </div>
        </div>

        <div id="resultados-recibo" class="animate__animated animate__fadeInUp" style="display:none;"></div>

        <div class="table-container" style="border-top: 4px solid var(--primary-blue);">
            <div style="padding: 15px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px;">
                <i class="material-icons" style="color: var(--primary-blue);">history</i>
                <h3 style="margin:0; font-size: 1rem;">Últimos 5 Recibos Generados</h3>
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>N° RECIBO</th>
                        <th>ESTUDIANTE</th>
                        <th>FECHA Y HORA</th>
                        <th style="text-align: right;">TOTAL</th>
                        <th style="text-align: center;">ACCIÓN</th>
                    </tr>
                </thead>
                <tbody id="body-ultimos-recibos">
                    <tr><td colspan="5" style="text-align:center; padding:20px;"><div class="spinner"></div> Cargando...</td></tr>
                </tbody>
            </table>
        </div>
    `;
    // Cargamos los últimos recibos al abrir la vista
    cargarUltimosRecibos();
}


async function buscarReciboFinal() {
    const input = document.getElementById('bus-nro-recibo');
    const btn = document.querySelector('.card-busqueda .btn-primary') || document.querySelector('button[onclick="buscarReciboFinal()"]');
    const area = document.getElementById('resultados-recibo');
    const nro = input.value.trim();

    if (!nro) return lanzarNotificacion('warning', 'AVISO', 'Ingresa un número de recibo.');

    // 1. Efecto Visual de Carga
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="material-icons rotate">sync</i> BUSCANDO';
    }
    
    // Mostramos un mensaje temporal en el área de resultados
    area.style.display = 'block';
    area.innerHTML = '<div style="text-align:center; padding:20px; color:var(--primary-blue); font-weight:700;">Consultando base de datos...</div>';

    try {
        const res = await sendRequest('buscarRecibo', { nroRecibo: nro });

        if (res.status === 'success') {
            const d = res.data; // Array con los registros del recibo
            
            area.innerHTML = `
                <div class="animate__animated animate__fadeIn" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:24px; padding:30px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <h3 style="margin:0; color:var(--primary-dark); font-size:1.5rem;">Detalle del Recibo N° ${nro}</h3>
                            <span style="color:var(--text-muted); font-weight:600;">Fecha de emisión: ${d[0].fecha}</span>
                        </div>
                        
                        <div style="display:flex; gap: 10px;">
                            <button class="btn-matricula-especial" onclick='reimprimirDesdeBusqueda(${JSON.stringify(d)}, "${nro}")' style="width:auto; padding:12px 20px; font-size:1rem;">
                                <i class="material-icons" style="margin-right:8px;">print</i> REIMPRIMIR
                            </button>

                            <button class="btn-matricula-especial" onclick='descargarTicketPDF(${JSON.stringify(d)}, "${nro}")' style="width:auto; padding:12px 20px; font-size:1rem; background-color: #ef4444; color: white; border: 1px solid #dc2626;">
                                <i class="material-icons" style="margin-right:8px;">picture_as_pdf</i> PDF
                            </button>
                        </div>
                    </div>
                    
                    <div style="background:white; border-radius:18px; border:1px solid #e2e8f0; overflow:hidden;">
                        <table style="width:100%; border-collapse:collapse;">
                            <thead style="background:#f1f5f9; color:var(--primary-dark); text-align:left;">
                                <tr>
                                    <th style="padding:15px;">ESTUDIANTE</th>
                                    <th style="padding:15px;">CONCEPTO</th>
                                    <th style="padding:15px; text-align:right;">PAGO TOTAL</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${d.map(it => {
                                    const totalVal = parseFloat(it.totalInd) || 0;
                                    return `
                                        <tr style="border-bottom:1px solid #f1f5f9;">
                                            <td style="padding:15px; font-weight:700;">${it.nombre}</td>
                                            <td style="padding:15px; color:var(--text-muted);">${it.nomCon}</td>
                                            <td style="padding:15px; text-align:right; font-weight:800; color:var(--primary-blue);">
                                                S/ ${totalVal.toFixed(2)}
                                            </td>
                                        </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            area.style.display = 'none';
            lanzarNotificacion('error', 'NO ENCONTRADO', res.message);
        }
    } catch (error) {
        console.error("Error en búsqueda:", error);
        area.style.display = 'none';
        lanzarNotificacion('error', 'SISTEMA', 'Error al conectar con el servidor.');
    } finally {
        // 2. Restaurar botón
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="material-icons">search</i> BUSCAR';
        }
    }
}

function reimprimirDesdeBusqueda(datos, nro) {
    // 1. MOSTRAR CARGA Y BLOQUEAR PANTALLA
    // Esto evita que el usuario presione el botón varias veces mientras se genera el iframe
    lanzarNotificacion('loading', 'IMPRESORA', 'Generando vista previa...');

    // 2. Extraemos los metadatos comunes
    const medio = datos[0].medio;
    const codOp = datos[0].codOp;
    const obs = datos[0].obs;
    
    // 3. Invocamos tu función de impresión
    // (Recuerda que esta función tiene un setTimeout interno de 1000ms)
    imprimirTicket(nro, datos, medio, codOp, obs);

    // 4. CERRAR CARGA SINCRONIZADA
    // Cerramos la notificación un poco después (1.2 seg) para que coincida 
    // justo cuando aparece el diálogo de impresión del navegador.
    setTimeout(() => {
        cerrarNotify();
    }, 1200);
}


/*----------------------------------------------------------------------------*/
/*HISTORIAL*/
// --- VARIABLES GLOBALES DEL MÓDULO ---
let listaEstudiantesGlobal = []; // Para el buscador local
let historialCache = [];         // Para ver detalles sin volver a pedir al servidor

/* --- ACTUALIZAR EN SCRIPT.JS --- */

function renderHistorialPagosView() {
    // 1. SEGURIDAD
    const rolesPermitidos = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!rolesPermitidos.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tiene permisos para ver el historial.');
        return;
    }

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header">
            <div>
                <h2>Historial de Pagos</h2>
                <p>Consulte todas las operaciones registradas por estudiante.</p>
            </div>
            <div class="anio-indicador">
                <i class="material-icons">calendar_today</i>
                <span>${anioActivoNombre}</span> </div>
        </div>

        <div class="card-config" style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; gap: 20px; align-items: flex-end; flex-wrap: wrap;">
                
                <div style="flex: 0 0 150px;">
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Año Académico</label>
                    <select id="hist-anio" class="custom-select" disabled style="background-color: #f1f5f9; cursor: not-allowed;">
                        <option value="${anioActivoID}" selected>${anioActivoNombre}</option>
                    </select>
                </div>

                <div style="flex: 1; min-width: 300px; position: relative;">
                    <label style="font-weight: 600; margin-bottom: 8px; display: block;">Buscar Estudiante</label>
                    <div class="search-container-masivo" style="max-width: 100%;">
                        <i class="material-icons">person_search</i>
                        <input type="text" id="hist-search" placeholder="Escriba Apellidos o DNI..." autocomplete="off" onkeyup="filtrarEstudiantesHistorial()">
                        <button id="btn-limpiar-hist" class="btn-clear-search" onclick="limpiarBuscadorHistorial()">
                            <i class="material-icons">close</i>
                        </button>
                    </div>
                    <div id="hist-search-results" class="search-results-box"></div>
                </div>

            </div>
        </div>

        <div class="table-container" id="hist-table-container" style="display:none; animation: fadeIn 0.3s ease;">
            <div style="padding: 15px 20px; background: #2563eb; color: white; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin:0; font-size: 1.1rem; color: white;" id="hist-student-name">Estudiante Seleccionado</h3>
                <span class="badge" style="background: white; color: #2563eb;" id="hist-count">0 Operaciones</span>
            </div>
            
            <table class="data-table">
                <thead>
                    <tr>
                        <th>N° RECIBO</th>
                        <th>CONCEPTO</th>
                        <th>FECHA</th>
                        <th>MÉTODO</th>
                        <th>CÓD. OP.</th>
                        <th style="text-align: right;">TOTAL</th>
                        <th style="text-align: center;">ACCIONES</th>
                    </tr>
                </thead>
                <tbody id="hist-table-body">
                </tbody>
            </table>
        </div>
    `;

    // Inicializamos (Ahora es más simple, solo carga estudiantes)
    inicializarVistaHistorial();
}

/* --- ACTUALIZAR EN SCRIPT.JS --- */

async function inicializarVistaHistorial() {
    try {
        // YA NO CARGAMOS AÑOS. USAMOS LA VARIABLE GLOBAL.
        
        // Cargar Lista de Estudiantes (Para el buscador)
        const resEst = await sendRequest('get_estudiantes');
        
        if (!document.getElementById('hist-search')) return; // Seguridad si cambiamos de pestaña

        if (resEst.status === 'success') {
            listaEstudiantesGlobal = resEst.data.map(e => ({
                id: e.id,
                nombreCompleto: `${e.paterno} ${e.materno}, ${e.nombres}`.toUpperCase(),
                dni: e.dni
            }));
        }

    } catch (error) {
        console.error("Error historial:", error);
    }
}

// --- LÓGICA DEL BUSCADOR ---
let estudianteSeleccionadoID = null;

function filtrarEstudiantesHistorial() {
    const input = document.getElementById('hist-search');
    const texto = input.value.toUpperCase();
    const resultadosBox = document.getElementById('hist-search-results');
    const btnLimpiar = document.getElementById('btn-limpiar-hist'); // Referencia al botón

    // --- LÓGICA DEL BOTÓN LIMPIAR ---
    // Si hay texto, mostramos el botón (block). Si está vacío, lo ocultamos (none).
    if (btnLimpiar) {
        btnLimpiar.style.display = texto.length > 0 ? 'block' : 'none';
    }
    // -------------------------------

    // Si hay muy poco texto, ocultamos resultados y salimos
    if (texto.length < 2) {
        resultadosBox.style.display = 'none';
        return;
    }

    // Filtramos la lista global (máximo 8 resultados)
    const filtrados = listaEstudiantesGlobal.filter(e => 
        e.nombreCompleto.includes(texto) || String(e.dni).includes(texto)
    ).slice(0, 8); 

    if (filtrados.length > 0) {
        resultadosBox.innerHTML = filtrados.map(e => `
            <div class="search-item" onclick="seleccionarEstudianteHistorial('${e.id}', '${e.nombreCompleto}')">
                <div style="font-weight: bold;">${e.nombreCompleto}</div>
                <div style="font-size: 0.85rem; color: #666;">DNI: ${e.dni}</div>
            </div>
        `).join('');
        resultadosBox.style.display = 'block';
    } else {
        resultadosBox.style.display = 'none';
    }
}

function limpiarBuscadorHistorial() {
    const input = document.getElementById('hist-search');
    const btnLimpiar = document.getElementById('btn-limpiar-hist');

    // 1. Borramos el texto
    input.value = '';
    
    // 2. Ocultamos el botón X
    if (btnLimpiar) btnLimpiar.style.display = 'none';

    // 3. Ocultamos resultados y tabla
    document.getElementById('hist-search-results').style.display = 'none';
    document.getElementById('hist-table-container').style.display = 'none';
    estudianteSeleccionadoID = null;

    // 4. (Opcional) Devolvemos el foco al input por comodidad
    input.focus();
}

function seleccionarEstudianteHistorial(id, nombre) {
    document.getElementById('hist-search').value = nombre;
    document.getElementById('hist-search-results').style.display = 'none';
    estudianteSeleccionadoID = id;
    
    // Actualizamos el título de la tabla
    document.getElementById('hist-student-name').innerText = nombre;
    
    // Disparamos la búsqueda
    cargarTablaHistorial();
}

function recargarHistorialSiHayEstudiante() {
    if (estudianteSeleccionadoID) {
        cargarTablaHistorial();
    }
}


async function cargarTablaHistorial() {
    const idAnio = anioActivoID;
    const tbody = document.getElementById('hist-table-body');
    const container = document.getElementById('hist-table-container');
    
    container.style.display = 'block';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px;"><div class="spinner"></div> Analizando cuenta corriente...</td></tr>`;

    try {
        const res = await sendRequest('get_historial_estudiante', {
            idEst: estudianteSeleccionadoID,
            idAnio: idAnio
        });

        if (res.status === 'success') {
            const pagos = res.pagos || [];
            const deudas = res.pendientes || [];

            document.getElementById('hist-count').innerText = `${pagos.length} Pagos | ${deudas.length} Pendientes`;

            if (pagos.length === 0 && deudas.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">Sin movimientos registrados.</td></tr>`;
                return;
            }

            let html = "";

            // 1. SECCIÓN DE DEUDAS (PENDIENTES) - Resaltado
            if (deudas.length > 0) {
                html += `
                <tr style="background-color: #fef2f2; border-bottom: 2px solid #fee2e2;">
                    <td colspan="7" style="padding: 10px; color: #b91c1c; font-weight: bold; text-transform: uppercase; font-size: 0.85rem;">
                        <i class="material-icons" style="font-size: 16px; vertical-align: bottom;">warning</i> 
                        Pagos Pendientes (${deudas.length})
                    </td>
                </tr>
                `;

                html += deudas.map(d => `
                <tr style="background-color: #fff1f2;">
                    <td style="color: #ef4444; font-weight:bold;">PENDIENTE</td>
                    <td style="font-weight:600;">${d.nomCon} <span style="font-size:10px; background:#fee2e2; color:#991b1b; padding:2px 4px; border-radius:4px;">${d.tipoCon}</span></td>
                    <td style="color: #7f1d1d; font-size: 0.9em;">Costo: S/ ${d.montoOriginal}</td>
                    <td colspan="2" style="color: #7f1d1d; font-size: 0.9em;">
                        ${d.pagado > 0 ? `Abonado: S/ ${d.pagado.toFixed(2)}` : 'Sin abonos'}
                    </td>
                    <td style="text-align: right; font-weight: bold; color: #dc2626;">S/ ${d.saldo.toFixed(2)}</td>
                    <td style="text-align: center;">
                        <button class="btn-icon delete" style="opacity:0.6; cursor:default;"><i class="material-icons">money_off</i></button>
                    </td>
                </tr>
                `).join('');
            }

            // 2. SECCIÓN DE PAGOS REALIZADOS
            if (pagos.length > 0) {
                html += `
                <tr style="background-color: #f0fdf4; border-bottom: 2px solid #dcfce7; border-top: 2px solid #e2e8f0;">
                    <td colspan="7" style="padding: 10px; color: #15803d; font-weight: bold; text-transform: uppercase; font-size: 0.85rem;">
                        <i class="material-icons" style="font-size: 16px; vertical-align: bottom;">check_circle</i> 
                        Historial de Pagos (${pagos.length})
                    </td>
                </tr>
                `;

                html += pagos.map((item, index) => {
                    const metodo = item.digital > 0 ? 
                        `<span style="color: #0ea5e9; font-weight:600;"><i class="material-icons" style="font-size:14px;">smartphone</i> ${item.medio || 'DIGITAL'}</span>` : 
                        `<span style="color: #059669; font-weight:600;"><i class="material-icons" style="font-size:14px;">payments</i> EFECTIVO</span>`;

                    return `
                    <tr>
                        <td style="font-weight:700; font-family:monospace;">${item.nroRecibo}</td>
                        <td>${item.nomCon}</td>
                        <td>${item.fecha}</td>
                        <td>${metodo}</td>
                        <td>${item.codOp || '---'}</td>
                        <td style="text-align: right; font-weight: bold; color: #1e293b;">S/ ${item.total.toFixed(2)}</td>
                        <td style="text-align: center;">
                            <button class="btn-icon view" onclick="verDetallePagoHistorial(${index}, title="Ver Detalle">
                                <i class="material-icons">visibility</i>
                            </button>
                        </td>
                    </tr>
                    `;
                }).join('');
            }

            tbody.innerHTML = html;

        } else {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: red;">${res.message}</td></tr>`;
        }

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: red;">Error de conexión.</td></tr>`;
    }
}

//
// --- MODAL DE DETALLE DEL RECIBO ---HISTORIAL
function verDetallePagoHistorial(index) {
    const data = historialCache[index];
    if (!data) return;

    // Calculamos el desglose (Efectivo vs Digital)
    let desgloseHTML = '';
    if (data.efectivo > 0) desgloseHTML += `<div>Efectivo: <b>S/ ${data.efectivo.toFixed(2)}</b></div>`;
    if (data.digital > 0) desgloseHTML += `<div>Digital (${data.medio}): <b>S/ ${data.digital.toFixed(2)}</b></div>`;

    const contenido = `
        <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 20px;">
            <div style="background: var(--primary-blue); color: white; padding: 15px; border-radius: 12px; text-align: center; min-width: 120px;">
                <div style="font-size: 0.8rem; opacity: 0.9;">N° RECIBO</div>
                <div style="font-size: 1.4rem; font-weight: 800;">${data.nroRecibo}</div>
            </div>
            <div style="flex: 1;">
                <h3 style="margin-top: 0; color: var(--sidebar-dark);">${data.nomCon}</h3>
                <div style="font-size: 0.95rem; color: #666;">
                    <i class="material-icons" style="font-size: 16px; vertical-align: text-top;">event</i> Registrado el: ${data.fecha}
                </div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
            
            <div>
                <span class="data-label">MONTO TOTAL</span>
                <div style="font-size: 1.2rem; font-weight: 700; color: var(--sidebar-dark);">S/ ${data.total.toFixed(2)}</div>
            </div>

            <div>
                <span class="data-label">DESGLOSE DE PAGO</span>
                <div style="font-size: 0.95rem;">${desgloseHTML}</div>
            </div>

            ${data.codOp ? `
            <div style="grid-column: span 2;">
                <span class="data-label">CÓDIGO DE OPERACIÓN</span>
                <div style="font-family: monospace; background: #fff; padding: 5px 10px; border: 1px solid #ddd; display: inline-block; border-radius: 4px;">
                    ${data.codOp}
                </div>
            </div>` : ''}

            <div style="grid-column: span 2; margin-top: 10px;">
                <span class="data-label">OBSERVACIONES</span>
                <div style="font-style: italic; color: #555;">${data.obs || 'Ninguna observación registrada.'}</div>
            </div>

            <div style="grid-column: span 2; border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: 5px;">
                <span class="data-label">REGISTRADO POR</span>
                <div style="font-size: 0.9rem;">${data.usuario}</div>
            </div>
        </div>

        <div style="margin-top: 25px; text-align: right;">
            <button type="button" class="btn-cancel" onclick="cerrarModal()">Cerrar</button>
        </div>
    `;

    mostrarModal('Detalle de Pago', contenido);
}


/*------------------
/* --- SISTEMA DE MODALES GLOBAL --- */

function mostrarModal(titulo, contenidoHTML) {
    const modal = document.getElementById('modal-global');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');

    if (modal && titleEl && bodyEl) {
        titleEl.innerText = titulo;
        bodyEl.innerHTML = contenidoHTML;
        
        // Mostramos el modal (usamos flex para centrarlo según tu CSS)
        modal.style.display = 'flex';
        
        // Animación de entrada suave (opcional, si tienes CSS de fade-in)
        // modal.classList.add('fade-in'); 
    } else {
        console.error("Error: No se encontró el contenedor del modal en el HTML.");
    }
}

function cerrarModal() {
    const modal = document.getElementById('modal-global');
    if (modal) {
        modal.style.display = 'none';
        // Limpiamos el contenido para ahorrar memoria
        document.getElementById('modal-body').innerHTML = '';
    }
}

// Cierra el modal si el usuario hace clic en la zona oscura (fuera de la tarjeta)
function cerrarModalFuera(event) {
    if (event.target.id === 'modal-global') {
        cerrarModal();
    }
}


/*-----------------------------------------------------------------------*/
// --- MÓDULO DE EGRESOS ---

function renderEgresosView() {
    // 1. Validación de Seguridad
    const rolesPermitidos = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!rolesPermitidos.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tiene autorización para este módulo.');
        return;
    }

    // 2. Fecha por defecto: HOY (Formato YYYY-MM-DD para el input)
    const hoy = new Date();
    const hoyStr = hoy.getFullYear() + '-' + 
                   String(hoy.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(hoy.getDate()).padStart(2, '0');

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header">
            <div>
                <h2>Control de Egresos</h2>
                <p>Gestión de gastos diarios de la institución.</p>
            </div>
            <div class="anio-indicador" style="background-color: #fef2f2 !important; color: #991b1b !important; border-color: #fecaca !important;">
                <i class="material-icons" style="color: #ef4444;">trending_down</i>
                <span>CAJA / SALIDAS</span>
            </div>
        </div>

        <div class="card-config" style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 25px; box-shadow: var(--shadow-sm); display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 20px;">
            
            <div style="flex: 0 0 250px;">
                <label style="font-weight: 600; margin-bottom: 8px; display: block; color: var(--text-muted);">Fecha de Consulta</label>
                <div class="search-container-masivo" style="padding: 5px 15px;">
                    <i class="material-icons">calendar_today</i>
                    <input type="date" id="egreso-fecha" value="${hoyStr}" onchange="cargarTablaEgresos()" 
                           style="border: none; outline: none; width: 100%; font-family: var(--font-main); color: var(--text-main); font-size: 1rem;">
                </div>
            </div>

            <div style="text-align: right;">
                <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 5px; font-weight: 600;">TOTAL DEL DÍA</div>
                <div id="egreso-total-dia" style="font-size: 2rem; font-weight: 800; color: #ef4444;">S/ 0.00</div>
            </div>

            <div>
                <button class="btn-primary" onclick="abrirModalNuevoEgreso()" style="background-color: #ef4444; display: flex; align-items: center; gap: 8px; padding: 12px 24px;">
                    <i class="material-icons">add_circle</i> REGISTRAR GASTO
                </button>
            </div>
        </div>

        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr style="background: #ef4444 !important;"> <th>CONCEPTO / DESCRIPCIÓN</th>
                        <th>OBSERVACIONES</th>
                        <th style="text-align: right; width: 150px;">MONTO</th>
                    </tr>
                </thead>
                <tbody id="body-egresos">
                    <tr><td colspan="3" style="text-align:center; padding: 20px;">Cargando datos...</td></tr>
                </tbody>
            </table>
        </div>
    `;

    // Cargamos los datos de la fecha inicial (HOY)
    cargarTablaEgresos();
}

async function cargarTablaEgresos() {
    const fecha = document.getElementById('egreso-fecha').value;
    const tbody = document.getElementById('body-egresos');
    const labelTotal = document.getElementById('egreso-total-dia');

    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px;"><div class="spinner"></div> Consultando gastos...</td></tr>`;

    try {
        const res = await sendRequest('get_egresos', { fecha: fecha });

        if (res.status === 'success') {
            const egresos = res.data;
            
            // Calculamos el total del día
            const totalDia = egresos.reduce((sum, item) => sum + item.monto, 0);
            labelTotal.innerText = `S/ ${totalDia.toFixed(2)}`;

            if (egresos.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px; color: #64748b;">No hay gastos registrados para esta fecha.</td></tr>`;
                return;
            }

            tbody.innerHTML = egresos.map(e => `
                <tr>
                    <td style="font-weight: 600;">${e.concepto}</td>
                    <td style="color: #64748b; font-style: italic;">${e.obs || '-'}</td>
                    <td style="text-align: right; font-weight: 700; color: #ef4444;">S/ ${e.monto.toFixed(2)}</td>
                </tr>
            `).join('');

        } else {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: red;">${res.message}</td></tr>`;
        }

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: red;">Error de conexión.</td></tr>`;
    }
}

// --- FORMULARIO NUEVO EGRESO ---
// --- FORMULARIO NUEVO EGRESO (SIN FECHA) ---
function abrirModalNuevoEgreso() {
    const formHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px;">
            
            <div style="background: #fef2f2; color: #b91c1c; padding: 10px; border-radius: 8px; font-size: 0.9rem; border: 1px dashed #fca5a5;">
                <i class="material-icons" style="font-size: 14px; vertical-align: middle;">event</i>
                Se registrará con la fecha y hora actual del sistema.
            </div>

            <div class="form-group">
                <label>Concepto del Gasto</label>
                <input type="text" id="new-egr-concepto" placeholder="Ej: Pago de Luz, Material de limpieza..." class="desc-input" style="width:100%;">
            </div>

            <div class="form-group">
                <label>Monto (S/)</label>
                <input type="number" id="new-egr-monto" placeholder="0.00" class="desc-input" style="width:100%; font-weight:bold; font-size: 1.2rem;">
            </div>

            <div class="form-group">
                <label>Observaciones (Opcional)</label>
                <input type="text" id="new-egr-obs" placeholder="Detalles adicionales..." class="desc-input" style="width:100%;">
            </div>

            <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 12px;">
                
                <button type="button" class="btn-cancel" onclick="cerrarModal()" 
                    style="background-color: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; padding: 12px 24px; border-radius: 8px; font-weight: 600;">
                    CANCELAR
                </button>

                <button type="button" class="btn-primary" onclick="guardarEgreso()" 
                    style="background-color: #ef4444; color: white; padding: 12px 30px; border-radius: 8px; font-weight: 700; box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 5px;">save</i> GUARDAR GASTO
                </button>

            </div>
        </div>
    `;

    mostrarModal('Registrar Nuevo Gasto', formHTML);
    
    // Auto-focus al concepto para ganar velocidad
    setTimeout(() => {
        const input = document.getElementById('new-egr-concepto');
        if(input) input.focus();
    }, 100);
}

async function guardarEgreso() {
    const concepto = document.getElementById('new-egr-concepto').value.trim();
    const monto = parseFloat(document.getElementById('new-egr-monto').value);
    const obs = document.getElementById('new-egr-obs').value.trim();

    // Validación simplificada (ya no validamos fecha)
    if (!concepto || isNaN(monto) || monto <= 0) {
        lanzarNotificacion('error', 'DATOS INCOMPLETOS', 'Ingrese un concepto válido y un monto mayor a 0.');
        return;
    }

    // Bloqueo visual
    const btn = document.querySelector('#modal-body .btn-primary');
    const txtOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> GUARDANDO...';

    try {
        // Ya no enviamos la fecha, el servidor la pone sola
        const res = await sendRequest('save_egreso', {
            concepto: concepto,
            monto: monto,
            obs: obs
        });

        if (res.status === 'success') {
            lanzarNotificacion('success', 'REGISTRADO', 'El gasto se guardó correctamente.');
            cerrarModal();
            
            // Recargamos la tabla. Como el gasto es "HOY", y la vista por defecto es "HOY",
            // aseguramos que el usuario vea su registro si está consultando la fecha actual.
            const fechaVista = document.getElementById('egreso-fecha').value;
            const hoyStr = new Date().toISOString().split('T')[0]; // Fecha actual YYYY-MM-DD
            
            if (fechaVista === hoyStr) {
                cargarTablaEgresos();
            } else {
                // Si el usuario estaba viendo el historial de ayer y registra un gasto hoy:
                lanzarNotificacion('info', 'REGISTRO EXITOSO', 'El gasto se registró con fecha de hoy.');
            }

        } else {
            lanzarNotificacion('error', 'ERROR', res.message);
            btn.disabled = false;
            btn.innerHTML = txtOriginal;
        }

    } catch (error) {
        console.error(error);
        lanzarNotificacion('error', 'CONEXIÓN', 'No se pudo guardar el gasto.');
        btn.disabled = false;
        btn.innerHTML = txtOriginal;
    }
}

//---------------------------------------------------------------------
/* --- MÓDULO CAJA DIARIA --- */

let cacheEgresosDia = []; // Guardaremos los egresos aquí para mostrarlos en el modal sin recargar
let cacheIngresosCaja = []; // <--- NUEVA CACHÉ

async function cargarCajaDiaria() {
    const fecha = document.getElementById('caja-fecha').value;
    const tbody = document.getElementById('body-caja-ingresos');
    const lEfe = document.getElementById('lbl-tot-efectivo');
    const lEgr = document.getElementById('lbl-tot-egresos');
    const lBal = document.getElementById('lbl-balance');
    const lDig = document.getElementById('lbl-tot-digital');

    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 30px;"><div class="spinner"></div> Procesando caja...</td></tr>`;
    const estiloCell = `padding: 6px 10px !important; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

    try {
        const res = await sendRequest('get_caja_diaria', { fecha: fecha });

        if (res.status === 'success') {
            const r = res.resumen;
            cacheEgresosDia = res.detalleEgresos;
            
            // 1. GUARDAMOS EN CACHÉ
            cacheIngresosCaja = res.detalleIngresos; 

            // Totales
            const saldoFisico = r.efectivo - r.egresos;
            lEfe.innerText = `S/ ${r.efectivo.toFixed(2)}`;
            lEgr.innerText = `S/ ${r.egresos.toFixed(2)}`;
            lBal.innerText = `S/ ${saldoFisico.toFixed(2)}`;
            lDig.innerText = `S/ ${r.digital.toFixed(2)}`;
            lBal.style.color = (saldoFisico < 0) ? '#fca5a5' : '#fff';

            // Tabla
            if (res.detalleIngresos.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 20px; color: #666;">Sin movimientos de ingreso.</td></tr>`;
            } else {
                tbody.innerHTML = res.detalleIngresos.map(i => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="${estiloCell} font-weight:700;">${i.nro}</td>
                        <td style="${estiloCell}" title="${i.estudiante}">${i.estudiante}</td>
                        <td style="${estiloCell}" title="${i.concepto}">${i.concepto}</td>
                        <td style="${estiloCell} text-align: right; color: #16a34a; font-weight:600;">${i.efectivo > 0 ? i.efectivo.toFixed(2) : '-'}</td>
                        <td style="${estiloCell} text-align: right; color: #0ea5e9; font-weight:600;">${i.digital > 0 ? i.digital.toFixed(2) : '-'}</td>
                        <td style="${estiloCell}">
                            ${i.medio ? `<span style="background:#f0f9ff; padding:1px 5px; border-radius:4px; color:#0369a1; font-size:0.75rem;">${i.medio}</span>` : ''}
                        </td>
                        <td style="${estiloCell} font-family: monospace; color: #64748b;">${i.codOp || ''}</td>
                        <td style="${estiloCell} text-align: right; font-weight: 800;">${i.total.toFixed(2)}</td>
                        <td style="${estiloCell} text-align: center;">
                            <button onclick="verDetalleCajaLocal('${i.nro}')" class="btn-icon view" style="width: 28px; height: 28px; font-size: 0.9rem; padding: 0;">
                                <i class="material-icons" style="font-size: 16px;">visibility</i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        } else {
            lanzarNotificacion('error', 'ERROR', res.message);
        }
    } catch (error) {
        console.error(error);
        lanzarNotificacion('error', 'CONEXIÓN', 'No se pudo cargar la caja.');
    }
}

// --- NUEVA FUNCIÓN: APERTURA INSTANTÁNEA ---
function verDetalleCajaLocal(nro) {
    // Filtramos todos los ítems de este recibo que están en memoria
    const itemsCaja = cacheIngresosCaja.filter(i => String(i.nro) === String(nro));
    
    if (itemsCaja.length === 0) return;

    // Convertimos el formato de Caja al formato que espera el Modal Detalle
    const itemsFormateados = itemsCaja.map(i => ({
        nombre: i.estudiante,
        nomCon: i.concepto,
        fecha: i.fechaHora, // Hora exacta traída del backend
        totalInd: i.total,
        efectivo: i.efectivo,
        digital: i.digital,
        medio: i.medio,
        codOp: i.codOp,
        usuario: i.usuario
    }));

    // ¡Reutilizamos tu función constructora existente!
    construirModalDetalle(nro, itemsFormateados);
}

function renderCajaView() {
    // 1. Permisos
    const roles = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!roles.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tiene permisos de tesorería.');
        return;
    }

    const hoy = new Date().toISOString().split('T')[0];
    const content = document.getElementById('content-area');
    
    // Estilos internos para compactar tabla solo en esta vista
    const estiloCompacto = `
        padding: 8px 10px !important; 
        font-size: 0.9rem !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;

    content.innerHTML = `
        <div class="module-header">
            <div>
                <h2>Caja Diaria</h2>
                <p>Cuadre de dinero físico y movimientos.</p>
            </div>
            <div class="anio-indicador" style="background-color: #ecfccb !important; color: #3f6212 !important; border-color: #d9f99d !important;">
                <i class="material-icons">point_of_sale</i>
                <span>TESORERÍA</span>
            </div>
        </div>

        <div class="card-config" style="background: white; padding: 12px 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: var(--shadow-sm); display: flex; align-items: center; gap: 15px;">
            <label style="font-weight: 700; color: #555; font-size: 0.9rem;">FECHA CIERRE:</label>
            <input type="date" id="caja-fecha" value="${hoy}" onchange="cargarCajaDiaria()" 
                   style="padding: 6px 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-family: var(--font-main); font-size: 0.95rem; color: var(--sidebar-dark); font-weight: 600;">
            <button class="btn-icon view" onclick="cargarCajaDiaria()" title="Actualizar" style="width: 34px; height: 34px;">
                <i class="material-icons" style="font-size: 18px;">refresh</i>
            </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 25px;">
            
            <div class="stat-card" style="background: white; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; border-left: 4px solid #16a34a; display: flex; flex-direction: column; justify-content: center;">
                <div style="color: #16a34a; font-weight: 700; font-size: 0.75rem; display: flex; align-items: center; gap: 5px;">
                    <i class="material-icons" style="font-size: 14px;">payments</i> ING. EFECTIVO
                </div>
                <div id="lbl-tot-efectivo" style="font-size: 1.4rem; font-weight: 700; color: #333; margin-top: 5px;">S/ 0.00</div>
            </div>

            <div class="stat-card" style="background: white; border: 1px solid #fecaca; padding: 15px; border-radius: 12px; border-left: 4px solid #ef4444; position: relative; display: flex; flex-direction: column; justify-content: center;">
                <div style="color: #ef4444; font-weight: 700; font-size: 0.75rem; display: flex; align-items: center; gap: 5px;">
                    <i class="material-icons" style="font-size: 14px;">trending_down</i> GASTOS
                </div>
                <div id="lbl-tot-egresos" style="font-size: 1.4rem; font-weight: 700; color: #ef4444; margin-top: 5px;">S/ 0.00</div>
                <button onclick="verDetalleEgresosModal()" style="position: absolute; top: 10px; right: 10px; background: #fef2f2; border: none; color: #ef4444; cursor: pointer; padding: 3px 8px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; display: flex; align-items: center; gap: 3px;">
                    <i class="material-icons" style="font-size: 12px;">visibility</i>
                </button>
            </div>

            <div class="stat-card" style="background: white; border: 1px solid #bae6fd; padding: 15px; border-radius: 12px; border-left: 4px solid #0ea5e9; display: flex; flex-direction: column; justify-content: center;">
                <div style="color: #0ea5e9; font-weight: 700; font-size: 0.75rem; display: flex; align-items: center; gap: 5px;">
                    <i class="material-icons" style="font-size: 14px;">qr_code_2</i> ING. DIGITAL
                </div>
                <div id="lbl-tot-digital" style="font-size: 1.4rem; font-weight: 700; color: #333; margin-top: 5px;">S/ 0.00</div>
            </div>

            <div class="stat-card" style="background: var(--sidebar-dark); color: white; padding: 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: flex; flex-direction: column; justify-content: center;">
                <div style="font-size: 0.75rem; font-weight: 700; opacity: 0.9; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px;">
                    <i class="material-icons" style="font-size: 14px;">account_balance_wallet</i> EN CAJA (FÍSICO)
                </div>
                <div id="lbl-balance" style="font-size: 1.4rem; font-weight: 800; color: #fff; margin-top: 5px;">S/ 0.00</div>
            </div>
        </div>

        <div class="table-container">
            <div style="padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
                <h3 style="margin:0; font-size: 1rem; color: var(--sidebar-dark);">Detalle de Ingresos</h3>
            </div>
            <table class="data-table" style="table-layout: fixed;">
                <thead>
                    <tr>
                        <th style="${estiloCompacto} width: 90px;">RECIBO</th>
                        <th style="${estiloCompacto} width: 25%;">ESTUDIANTE</th>
                        <th style="${estiloCompacto} width: 20%;">CONCEPTO</th>
                        <th style="${estiloCompacto} text-align: right; width: 10%;">EFECTIVO</th>
                        <th style="${estiloCompacto} text-align: right; width: 10%;">DIGITAL</th>
                        <th style="${estiloCompacto} width: 10%;">MEDIO</th>
                        <th style="${estiloCompacto} width: 12%;">CÓD. OP</th>
                        <th style="${estiloCompacto} text-align: right; width: 12%;">TOTAL</th>
                        <th style="${estiloCompacto} text-align: center; width: 50px;">VER</th>
                    </tr>
                </thead>
                <tbody id="body-caja-ingresos">
                    <tr><td colspan="9" style="text-align:center;">Cargando...</td></tr>
                </tbody>
            </table>
        </div>
    `;

    cargarCajaDiaria();
}


// --- MODAL PARA VER DETALLE DE EGRESOS ---
function verDetalleEgresosModal() {
    if (!cacheEgresosDia || cacheEgresosDia.length === 0) {
        lanzarNotificacion('info', 'VACÍO', 'No hay egresos registrados en esta fecha.');
        return;
    }

    const fechaVista = document.getElementById('caja-fecha').value;
    
    // Construimos una tabla simple para el modal
    let htmlTabla = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 8px; margin-bottom: 15px; color: #991b1b; font-weight: 600;">
            Fecha: ${fechaVista}
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
            <thead>
                <tr style="background: #ef4444; color: white;">
                    <th style="padding: 10px; text-align: left; border-radius: 6px 0 0 6px;">Concepto</th>
                    <th style="padding: 10px; text-align: left;">Obs</th>
                    <th style="padding: 10px; text-align: right; border-radius: 0 6px 6px 0;">Monto</th>
                </tr>
            </thead>
            <tbody>
    `;

    let suma = 0;
    cacheEgresosDia.forEach(e => {
        suma += e.monto;
        htmlTabla += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${e.concepto}</td>
                <td style="padding: 10px; color: #666; font-style: italic; font-size: 0.85rem;">${e.obs || ''}</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: #ef4444;">S/ ${e.monto.toFixed(2)}</td>
            </tr>
        `;
    });

    htmlTabla += `
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="2" style="padding: 15px; text-align: right; font-weight: 800;">TOTAL EGRESOS:</td>
                    <td style="padding: 15px; text-align: right; font-weight: 800; font-size: 1.1rem; color: #ef4444;">S/ ${suma.toFixed(2)}</td>
                </tr>
            </tfoot>
        </table>
        
        <div style="margin-top: 20px; text-align: right;">
            <button class="btn-cancel" onclick="cerrarModal()">Cerrar</button>
        </div>
    `;

    mostrarModal('Detalle de Egresos', htmlTabla);
}

//-----------------------------------------------------------------------
//ÚLTIMOS 5 RECIBOS
/* --- ACTUALIZAR EN SCRIPT.JS --- */

// Variable para almacenamiento local (caché)
let cacheUltimosRecibos = {}; 

async function cargarUltimosRecibos() {
    const tbody = document.getElementById('body-ultimos-recibos');
    if (!tbody) return;

    try {
        const res = await sendRequest('get_ultimos_recibos');

        if (res && res.status === 'success') {
            const lista = res.data || [];
            
            // 1. LIMPIAR Y LLENAR CACHÉ
            cacheUltimosRecibos = {}; // Reset
            lista.forEach(r => {
                // Guardamos los detalles completos usando el Nro como clave
                cacheUltimosRecibos[r.nro] = r.detalles; 
            });

            if (lista.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">No hay recibos recientes.</td></tr>`;
                return;
            }

            // 2. RENDERIZAR LA TABLA (Usando los datos de resumen)
            tbody.innerHTML = lista.map(r => `
                <tr>
                    <td style="font-weight: 800; color: var(--primary-blue);">${r.nro}</td>
                    <td style="font-size: 0.85rem;">${r.estudiante}</td>
                    <td style="font-size: 0.8rem; color: #666;">${r.fecha}</td>
                    <td style="text-align: right; font-weight: 700;">S/ ${Number(r.total).toFixed(2)}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            <button class="btn-icon view" onclick="verDetalleReciboModal('${r.nro}')" title="Ver Detalles">
                                <i class="material-icons" style="font-size:18px;">visibility</i>
                            </button>
                            <button class="btn-icon edit" onclick="reimprimirDirecto('${r.nro}')" title="Reimprimir Ticket" style="background: #f0fdf4; color: #16a34a;">
                                <i class="material-icons" style="font-size:18px;">print</i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red; padding:20px;">Error al cargar historial.</td></tr>`;
        }
    } catch (error) {
        console.error("Error en historial:", error);
    }
}

// --- FUNCIÓN OPTIMIZADA: REIMPRESIÓN INSTANTÁNEA ---
function reimprimirDirecto(nro) {
    // Verificamos si tenemos los datos en caché
    const datosCache = cacheUltimosRecibos[nro];

    if (datosCache) {
        // ¡SÍ ESTÁN! Imprimimos directo sin ir al servidor (0ms delay)
        lanzarNotificacion('loading', 'IMPRESORA', 'Generando ticket...');
        
        const medio = datosCache[0].medio;
        const codOp = datosCache[0].codOp;
        const obs = datosCache[0].obs;

        // Ejecutamos la impresión
        imprimirTicket(nro, datosCache, medio, codOp, obs);

        // Cerramos la notificación un poco después para dar efecto visual
        setTimeout(() => cerrarNotify(), 800);

    } else {
        // FALLBACK: Si por alguna razón no está en caché (raro), vamos al servidor
        console.warn("Dato no en caché, solicitando al servidor...");
        reimprimirDesdeServidor(nro); 
    }
}

// --- FUNCIÓN OPTIMIZADA: VISTA DETALLE INSTANTÁNEA ---
function verDetalleReciboModal(nro) {
    const items = cacheUltimosRecibos[nro];

    if (items) {
        // ¡SÍ ESTÁN! Renderizamos el modal al instante
        construirModalDetalle(nro, items);
    } else {
        // Fallback al servidor
        buscarDetalleServidor(nro);
    }
}

// --- FUNCIONES AUXILIARES PARA EVITAR CÓDIGO DUPLICADO ---

function construirModalDetalle(nro, items) {
    const d = items[0]; 
    const totalRecibo = items.reduce((sum, it) => sum + it.totalInd, 0);

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px;">
            <div>
                <div style="font-size: 0.8rem; color: #64748b; font-weight: 700;">ESTUDIANTE</div>
                <div style="font-size: 1.1rem; font-weight: 800; color: var(--sidebar-dark);">${d.nombre}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 0.8rem; color: #64748b; font-weight: 700;">FECHA</div>
                <div style="font-size: 1rem; font-weight: 600;">${d.fecha}</div>
            </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
                <tr style="background: #f8fafc; text-align: left;">
                    <th style="padding: 10px; font-size: 0.8rem; color: #64748b;">CONCEPTO</th>
                    <th style="padding: 10px; font-size: 0.8rem; color: #64748b; text-align: right;">TOTAL</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(it => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 10px; font-size: 0.9rem; font-weight: 600;">${it.nomCon}</td>
                        <td style="padding: 10px; font-size: 0.9rem; font-weight: 700; text-align: right;">S/ ${it.totalInd.toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 15px; border-radius: 12px;">
            <div>
                <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; display: block;">MÉTODO DE PAGO</span>
                <span style="font-size: 0.9rem; font-weight: 600;">
                    ${d.efectivo > 0 ? 'EFECTIVO ' : ''} ${d.digital > 0 ? '| ' + d.medio : ''}
                </span>
            </div>
            <div style="text-align: right;">
                <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; display: block;">TOTAL COBRADO</span>
                <span style="font-size: 1.2rem; font-weight: 800; color: var(--primary-blue);">S/ ${totalRecibo.toFixed(2)}</span>
            </div>
            ${d.codOp ? `<div style="grid-column: span 2; border-top: 1px solid #e2e8f0; pt: 8px;">
                <span style="font-size: 0.75rem; font-weight: 700; color: #64748b;">CÓD. OPERACIÓN:</span>
                <span style="font-family: monospace; font-weight: 600;">${d.codOp}</span>
            </div>` : ''}
        </div>

        <div style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn-cancel" onclick="cerrarModal()">Cerrar</button>
            <button class="btn-primary" onclick="reimprimirDirecto('${nro}')" style="background: #16a34a;">
                <i class="material-icons">print</i> REIMPRIMIR
            </button>
        </div>
    `;
    mostrarModal(`DETALLE DE RECIBO N° ${nro}`, html);
}

// Fallbacks (Solo por si acaso se limpó la caché)
async function reimprimirDesdeServidor(nro) {
    lanzarNotificacion('loading', 'SISTEMA', 'Recuperando datos...');
    try {
        const res = await sendRequest('buscarRecibo', { nroRecibo: nro });
        cerrarNotify();
        if (res.status === 'success') {
            const d = res.data;
            imprimirTicket(nro, d, d[0].medio, d[0].codOp, d[0].obs);
        }
    } catch(e) { cerrarNotify(); }
}

async function buscarDetalleServidor(nro) {
    lanzarNotificacion('loading', 'SISTEMA', 'Recuperando datos...');
    try {
        const res = await sendRequest('buscarRecibo', { nroRecibo: nro });
        cerrarNotify();
        if (res.status === 'success') construirModalDetalle(nro, res.data);
    } catch(e) { cerrarNotify(); }
}



/*--------------------------------------------------*/
/* --- MÓDULO DASHBOARD --- */
/* --- SCRIPT.JS: CARGA INTELIGENTE --- */
let cacheDashboardData = null; // Memoria local
// Variables globales para los objetos de Chart.js (para poder destruirlos al recargar)
let chartPrimariaObj = null;
let chartSecundariaObj = null;
let cacheEventosCalendario = []; // Variable global

function renderDashboardView() {
    const rolesAutorizados = ['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'];
    if (!currentUser || !rolesAutorizados.includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tiene permisos.');
        return;
    }

    const content = document.getElementById('content-area');
    const d = cacheDashboardData ? cacheDashboardData.stats : { total: 0, primaria: 0, secundaria: 0, hoy: 0 };
    const filasTabla = cacheDashboardData ? generarFilasTablaDashboard(cacheDashboardData.secciones) : '<tr><td colspan="5" style="text-align:center;">Cargando...</td></tr>';

    const html = `
        <div class="dashboard-container animate-fade-in">
            <div class="module-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px;">
                <div>
                    <h2 style="font-size:2rem; font-weight:800;">Panel de Control</h2>
                    <p style="color:#64748b;">Resumen general del estado académico actual.</p>
                </div>
                <div class="anio-indicador">
                    <i class="material-icons">event</i>
                    <span>AÑO LECTIVO: ${anioActivoNombre}</span>
                </div>
            </div>

            <div class="dashboard-grid-top">
                <div class="metrics-area">
                    <div class="dash-card" style="border-left: 6px solid #2563eb;">
                        <i class="material-icons" style="font-size:40px; color:#2563eb">groups</i>
                        <div>
                            <span class="stat-label">TOTAL MATRICULADOS</span>
                            <div id="dash-total" class="stat-value">${d.total}</div>
                        </div>
                    </div>
                    <div class="dash-card" style="border-left: 6px solid #06b6d4;">
                        <i class="material-icons" style="font-size:40px; color:#06b6d4">local_library</i>
                        <div>
                            <span class="stat-label">NIVEL PRIMARIA</span>
                            <div id="dash-primaria" class="stat-value">${d.primaria}</div>
                        </div>
                    </div>
                    <div class="dash-card" style="border-left: 6px solid #8b5cf6;">
                        <i class="material-icons" style="font-size:40px; color:#8b5cf6">school</i>
                        <div>
                            <span class="stat-label">NIVEL SECUNDARIA</span>
                            <div id="dash-secundaria" class="stat-value">${d.secundaria}</div>
                        </div>
                    </div>
                    <div class="dash-card" style="border-left: 6px solid #10b981;">
                        <i class="material-icons" style="font-size:40px; color:#10b981">event_available</i>
                        <div>
                            <span class="stat-label">MATRÍCULAS DE HOY</span>
                            <div id="dash-hoy" class="stat-value">${d.hoy}</div>
                        </div>
                    </div>
                </div>

                <div class="dash-card pop-in" style="animation-delay: 0.4s; flex-direction:column; align-items:stretch; align-self: start; transition: all 0.3s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <i class="material-icons" style="color: #64748b; font-size: 20px;">calendar_month</i>
                            <h3 style="font-size:1rem; margin:0; color: #1e293b;">Calendario</h3>
                        </div>
                        <button onclick="toggleCalendario()" class="btn-icon-small" id="btn-toggle-cal">
                            <i class="material-icons">expand_more</i>
                        </button>
                    </div>

                    <div id="calendar-collapsible" style="display: none; border-top: 1px solid #f1f5f9; padding-top: 15px; margin-top: 10px;">
                        <div id="calendar-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; gap: 10px;">
                            <button onclick="cambiarMesCalendario(-1)" class="btn-icon-small"><i class="material-icons">chevron_left</i></button>
                            
                            <div style="display: flex; gap: 5px; flex-grow: 1; justify-content: center;">
                                <select id="select-mes-cal" onchange="irAFechaSeleccionada()" class="select-calendar" style="width: 80px; font-size: 0.75rem; padding: 2px;"></select>
                                <select id="select-anio-cal" onchange="irAFechaSeleccionada()" class="select-calendar" style="width: 60px; font-size: 0.75rem; padding: 2px;"></select>
                            </div>

                            <button onclick="cambiarMesCalendario(1)" class="btn-icon-small"><i class="material-icons">chevron_right</i></button>
                        </div>
                        
                        <div class="calendar-weekdays" style="display:grid; grid-template-columns: repeat(7, 1fr); text-align:center; font-weight:800; font-size:0.7rem; color:#94a3b8; margin-bottom:10px;">
                            <div>DOM</div><div>LUN</div><div>MAR</div><div>MIÉ</div><div>JUE</div><div>VIE</div><div>SÁB</div>
                        </div>

                        <div id="calendar-body-grid" class="calendar-grid" style="display:grid; grid-template-columns: repeat(7, 1fr); gap: 5px; width: 100%; overflow: hidden;">
                            </div>
                    </div>
                </div>
            </div>

            <div class="dashboard-grid-charts" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 25px;">
                <div class="chart-card" style="background:white; padding:20px; border-radius:16px; box-shadow: var(--shadow-soft);">
                    <h3 style="margin-bottom:15px; font-size:1.1rem; color: #1e293b;">Matrícula por Grado - Primaria</h3>
                    <div style="height: 250px;"><canvas id="chartPrimaria"></canvas></div>
                </div>
                <div class="chart-card" style="background:white; padding:20px; border-radius:16px; box-shadow: var(--shadow-soft);">
                    <h3 style="margin-bottom:15px; font-size:1.1rem; color: #1e293b;">Matrícula por Grado - Secundaria</h3>
                    <div style="height: 250px;"><canvas id="chartSecundaria"></canvas></div>
                </div>
            </div>

            <div class="table-container" style="margin-top: 25px;">
                <div style="padding: 15px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <h3 style="margin:0; font-size: 1.1rem; color: var(--sidebar-dark);">Resumen de Alumnos por Sección</h3>
                </div>
                <table class="data-table">
                    <thead>
                        <tr><th>NIVEL</th><th>GRADO</th><th>SECCIÓN</th><th style="text-align:center;">ALUMNOS</th><th style="text-align:center;">ESTADO</th></tr>
                    </thead>
                    <tbody id="dash-body-secciones">
                        ${filasTabla}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    content.innerHTML = html;
    // 1. Inicializamos calendario
    initCalendar(); 
    
    // 2. Si ya tenemos eventos en caché (del login), los dibujamos de inmediato
    if (cacheEventosCalendario && cacheEventosCalendario.length > 0) {
        renderizarCalendario(); 
    }

    // 3. Dibujamos gráficos si hay datos
    if (cacheDashboardData) {
        renderizarGraficosDashboard(cacheDashboardData.secciones);
    }

    // --- EL CAMBIO: No llamar inmediatamente ---
    // Limpiamos cualquier intervalo previo si existiera
    if (window.intervaloDash) clearInterval(window.intervaloDash);
    
    // Esperamos 10 segundos para el primer chequeo y luego cada 1 minuto
    setTimeout(() => {
        actualizarCacheDashboardSilencioso();
        window.intervaloDash = setInterval(actualizarCacheDashboardSilencioso, 60000); 
    }, 10000);
}


function renderizarGraficosDashboard(secciones) {
    // 1. Mapa de jerarquía para asegurar el orden pedagógico
    const ordenGrados = {
        'PRIMERO': 1, '1°': 1, '1RO': 1,
        'SEGUNDO': 2, '2°': 2, '2DO': 2,
        'TERCERO': 3, '3°': 3, '3RO': 3,
        'CUARTO': 4,  '4°': 4, '4TO': 4,
        'QUINTO': 5,  '5°': 5, '5TO': 5,
        'SEXTO': 6,   '6°': 6, '6TO': 6
    };

    const obtenerDatosPorNivel = (nivelStr) => {
        const agrupar = {};
        secciones.filter(s => s.nivel === nivelStr).forEach(s => {
            agrupar[s.grado] = (agrupar[s.grado] || 0) + s.alumnos;
        });
        
        // --- CAMBIO CLAVE: Ordenamiento Inteligente ---
        const labels = Object.keys(agrupar).sort((a, b) => {
            const valA = ordenGrados[a.toUpperCase()] || 99; // 99 para grados desconocidos al final
            const valB = ordenGrados[b.toUpperCase()] || 99;
            return valA - valB;
        });

        const data = labels.map(l => agrupar[l]);
        return { labels, data };
    };

    const primaria = obtenerDatosPorNivel('PRIMARIA');
    const secundaria = obtenerDatosPorNivel('SECUNDARIA');

    // 2. Configuración estética de Chart.js
    const configBase = (labels, data, color) => ({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: color,
                borderRadius: 8,
                barThickness: 30
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` Alumnos: ${context.raw}`;
                        }
                    }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { display: false }, 
                    ticks: { 
                        stepSize: 1,
                        font: { weight: 'bold' } 
                    } 
                },
                x: { 
                    grid: { display: false },
                    ticks: { font: { weight: 'bold' } }
                }
            }
        }
    });

    // 3. Destruir instancias previas
    if (typeof chartPrimariaObj !== 'undefined' && chartPrimariaObj) chartPrimariaObj.destroy();
    if (typeof chartSecundariaObj !== 'undefined' && chartSecundariaObj) chartSecundariaObj.destroy();

    // 4. Crear los nuevos gráficos
    const canvasPri = document.getElementById('chartPrimaria');
    const canvasSec = document.getElementById('chartSecundaria');

    if (canvasPri && canvasSec) {
        const ctxPri = canvasPri.getContext('2d');
        const ctxSec = canvasSec.getContext('2d');

        chartPrimariaObj = new Chart(ctxPri, configBase(primaria.labels, primaria.data, '#06b6d4'));
        chartSecundariaObj = new Chart(ctxSec, configBase(secundaria.labels, secundaria.data, '#8b5cf6'));
    }
}

// Función auxiliar para no repetir código
function generarFilasTablaDashboard(secciones) {
    return secciones.map(sec => `
        <tr>
            <td style="font-size:0.85rem; font-weight:700; color:#64748b;">${sec.nivel}</td>
            <td style="font-weight:600;">${sec.grado}</td>
            <td>${sec.seccion}</td>
            <td style="text-align:center;">
                <span style="background:#f1f5f9; padding:4px 12px; border-radius:12px; font-weight:800; color:var(--primary-blue);">${sec.alumnos}</span>
            </td>
            <td style="text-align:center;"><span class="badge" style="background:#dcfce7; color:#16a34a; border:none;">ACTIVO</span></td>
        </tr>
    `).join('');
}

async function cargarDatosDashboard() {
    if (!anioActivoID) return;

    try {
        const res = await sendRequest('get_stats_dashboard', { idAnio: anioActivoID });
        
        if (res.status === 'success') {
            // Si la data nueva es diferente a la caché (o no hay caché), animamos
            const dataCambio = JSON.stringify(res) !== JSON.stringify(cacheDashboardData);
            
            cacheDashboardData = res; 

            if (dataCambio) {
                mostrarDatosEnDashboard(res);
            }
        }
    } catch (e) { console.error("Error en dashboard:", e); }
    cargarEventosDelServidor();
}

function mostrarDatosEnDashboard(res) {
    const s = res.stats;
    
    // 1. GUARDIA DE SEGURIDAD: Verificar si estamos físicamente en el Dashboard
    const totalEl = document.getElementById('dash-total');
    if (!totalEl) {
        console.log("📌 Datos del Dashboard actualizados en memoria (silencioso).");
        return; // Salimos de la función si no hay elementos que pintar
    }

    // 2. Si llegamos aquí, es porque el Dashboard SÍ está en pantalla
    // Tarjetas (con animación de conteo)
    animarNumero('dash-total', s.total);
    animarNumero('dash-primaria', s.primaria);
    animarNumero('dash-secundaria', s.secundaria);
    animarNumero('dash-hoy', s.hoy);

    // Tabla de secciones
    const tbody = document.getElementById('dash-body-secciones');
    if (tbody) {
        if (res.secciones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay datos.</td></tr>';
        } else {
            tbody.innerHTML = generarFilasTablaDashboard(res.secciones);
        }
    }
}


/* --- SCRIPT.JS: CARGA DE DATOS --- */
async function cargarDatosDashboard() {
    if (!anioActivoID) return;

    try {
        const res = await sendRequest('get_stats_dashboard', { idAnio: anioActivoID });
        
        if (res.status === 'success') {
            // Actualizamos la variable global de memoria SIEMPRE
            cacheDashboardData = res; 
            
            // Solo intentamos pintar si la función detecta los elementos
            mostrarDatosEnDashboard(res);
        }
    } catch (e) { 
        console.error("Error cargando dashboard:", e); 
    }
    cargarEventosDelServidor();
}

// Función auxiliar para que los números "suban" animadamente
function animarNumero(id, valorFinal) {
    const el = document.getElementById(id);
    if (!el) return;
    
    // --- MEJORA: Si el valor ya es el mismo, no animar ---
    if (parseInt(el.innerText) === parseInt(valorFinal)) return;
    
    let inicio = parseInt(el.innerText) || 0;
    const duracion = 800; 
    const incremento = (valorFinal - inicio) / (duracion / 16);
    
    const actualizar = () => {
        inicio += incremento;
        if ((incremento > 0 && inicio < valorFinal) || (incremento < 0 && inicio > valorFinal)) {
            el.innerText = Math.floor(inicio);
            requestAnimationFrame(actualizar);
        } else {
            el.innerText = valorFinal;
        }
    };
    actualizar();
}

/* --- FUNCIÓN FALTANTE: GESTIÓN DE MENÚ ACTIVO --- */
function actualizarItemActivo(el) {
    if (!el) return;
    document.querySelectorAll('.menu-item, .dropdown-btn, .dropdown-content a').forEach(item => {
        item.classList.remove('active-item');
    });
    el.classList.add('active-item');
}

async function actualizarCacheDashboardSilencioso() {
    if (!anioActivoID) return;

    try {
        const [resStats, resEv] = await Promise.all([
            sendRequest('get_stats_dashboard', { idAnio: anioActivoID }),
            sendRequest('get_events', { idAnio: anioActivoID })
        ]);

        // 1. Validar Estadísticas: ¿Cambiaron los datos?
        if (resStats.status === 'success') {
            const statsCambiaron = JSON.stringify(resStats.stats) !== JSON.stringify(cacheDashboardData?.stats);
            const seccionesCambiaron = JSON.stringify(resStats.secciones) !== JSON.stringify(cacheDashboardData?.secciones);

            if (statsCambiaron || seccionesCambiaron) {
                console.log("🔄 Cambios detectados, actualizando interfaz...");
                cacheDashboardData = resStats;
                
                const currentView = document.getElementById('dash-total');
                if (currentView) {
                    animarNumero('dash-total', resStats.stats.total);
                    animarNumero('dash-primaria', resStats.stats.primaria);
                    animarNumero('dash-secundaria', resStats.stats.secundaria);
                    animarNumero('dash-hoy', resStats.stats.hoy);
                    
                    if (seccionesCambiaron) {
                        document.getElementById('dash-body-secciones').innerHTML = generarFilasTablaDashboard(resStats.secciones);
                        if (document.getElementById('chartPrimaria')) renderizarGraficosDashboard(resStats.secciones);
                    }
                }
            }
        }

        // 2. Validar Eventos: ¿Hay nuevos eventos o eliminados?
        if (resEv.status === 'success') {
            const eventosCambiaron = JSON.stringify(resEv.eventos) !== JSON.stringify(cacheEventosCalendario);
            if (eventosCambiaron) {
                cacheEventosCalendario = resEv.eventos;
                if (document.getElementById('calendar-body-grid')) renderizarCalendario();
            }
        }

    } catch (e) { console.warn("Error en sincronización silenciosa", e); }
}


/* --- LÓGICA DEL CALENDARIO INTERACTIVO --- */
let fechaCalendario = new Date(); // Fecha actual por defecto

function initCalendar() {
    fechaCalendario = new Date();
}

function cambiarMesCalendario(offset) {
    // Sumamos o restamos meses a la fecha actual del calendario
    fechaCalendario.setMonth(fechaCalendario.getMonth() + offset);
    renderizarCalendario();
}

/* --- LÓGICA DE CALENDARIO MEJORADA --- */

/* --- REEMPLAZA TU FUNCIÓN CON ESTA --- */

function renderizarCalendario() {
    const grid = document.getElementById('calendar-body-grid');
    const selectMes = document.getElementById('select-mes-cal');
    const selectAnio = document.getElementById('select-anio-cal');
    if (!grid || !selectMes || !selectAnio) return;

    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const anioActual = new Date().getFullYear();
    const mesActual = parseInt(fechaCalendario.getMonth());
    const anioCalendario = parseInt(fechaCalendario.getFullYear());

    if (selectMes.innerHTML === "") {
        selectMes.innerHTML = meses.map((m, idx) => `<option value="${idx}">${m}</option>`).join('');
    }
    if (selectAnio.innerHTML === "") {
        let opcionesAnio = "";
        for (let i = anioActual - 5; i <= anioActual + 5; i++) {
            opcionesAnio += `<option value="${i}">${i}</option>`;
        }
        selectAnio.innerHTML = opcionesAnio;
    }

    selectMes.value = mesActual;
    selectAnio.value = anioCalendario;

    grid.innerHTML = "";
    const primerDiaMes = new Date(anioCalendario, mesActual, 1).getDay();
    const ultimoDiaMes = new Date(anioCalendario, mesActual + 1, 0).getDate();
    const hoy = new Date();
    const hoyISO = hoy.toISOString().split('T')[0];

    // 1. Espacios vacíos (Ajustados para no ocupar espacio extra)
    for (let i = 0; i < primerDiaMes; i++) {
        const div = document.createElement('div');
        div.style.minHeight = "35px"; // Altura mínima controlada
        grid.appendChild(div);
    }

    // 2. Dibujar los días
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const div = document.createElement('div');
        div.className = "calendar-day";
        
        // --- ESTILOS CRÍTICOS PARA EVITAR DESBORDAMIENTO ---
        div.style.display = "flex";
        div.style.flexDirection = "column";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.padding = "2px";
        div.style.minHeight = "38px"; // Altura fija para que no crezca el cuadro
        div.style.position = "relative";
        div.style.overflow = "hidden"; // Evita que los puntos se salgan
        // ---------------------------------------------------
        
        const mm = String(mesActual + 1).padStart(2, '0');
        const dd = String(dia).padStart(2, '0');
        const fechaISO = `${anioCalendario}-${mm}-${dd}`;
        
        const eventosDia = cacheEventosCalendario.filter(ev => {
            if (!ev.fecha) return false;
            const fechaEvFormateada = new Date(ev.fecha).toISOString().split('T')[0];
            return fechaEvFormateada === fechaISO;
        });

        // Número del día con fuente pequeña
        div.innerHTML = `<span class="day-number" style="font-size: 0.8rem; font-weight: 600;">${dia}</span>`;

        if (eventosDia.length > 0) {
            const containerPuntos = document.createElement('div');
            // Estilos para que los puntos no empujen el cuadro
            containerPuntos.style.display = "flex";
            containerPuntos.style.gap = "2px";
            containerPuntos.style.marginTop = "2px";
            containerPuntos.style.justifyContent = "center";
            
            eventosDia.slice(0, 3).forEach(ev => {
                const dot = document.createElement('span');
                dot.style.width = "4px";
                dot.style.height = "4px";
                dot.style.borderRadius = "50%";
                dot.style.backgroundColor = obtenerColorCategoria(ev.categoria);
                containerPuntos.appendChild(dot);
            });
            
            div.appendChild(containerPuntos);
            div.onclick = () => mostrarDetalleEventos(eventosDia, fechaISO);
        } else {
            div.onclick = () => abrirModalEvento(fechaISO);
        }

        if (fechaISO === hoyISO) {
            div.classList.add('today');
            div.style.backgroundColor = "#dbeafe"; // Azul muy suave para hoy
            div.style.borderRadius = "8px";
        }
        
        grid.appendChild(div);
    }
}

// Función auxiliar para colores
function obtenerColorCategoria(cat) {
    const colores = {
        'General':  '#2563eb',            // Azul
        'PP.FF.': '#9c2796',           // Morado
        'Estudiantes': '#10b981',       // Verde
        'Personal Laboral': '#f59e0b'   // Naranja
    };
    return colores[cat] || '#ef4444';   // Rojo por defecto
}

// Nueva función para saltar a la fecha elegida en los combos
function irAFechaSeleccionada() {
    const mes = document.getElementById('select-mes-cal').value;
    const anio = document.getElementById('select-anio-cal').value;
    
    fechaCalendario.setMonth(parseInt(mes));
    fechaCalendario.setFullYear(parseInt(anio));
    
    renderizarCalendario();
}

function toggleCalendario() {
    const contenedor = document.getElementById('calendar-collapsible');
    const btn = document.getElementById('btn-toggle-cal');
    const icon = btn.querySelector('.material-icons');

    if (contenedor.style.display === 'none') {
        // DESPLEGAR
        contenedor.style.display = 'block';
        icon.innerText = 'expand_less';
        // Renderizamos al desplegar para asegurar que los selectores y días estén al día
        renderizarCalendario();
    } else {
        // ENCOGER
        contenedor.style.display = 'none';
        icon.innerText = 'expand_more';
    }
}


function abrirModalEvento(fecha) {
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    
    modalTitle.innerText = "Registrar Evento: " + fecha;
    
    modalBody.innerHTML = `
        <form id="form-evento" style="display: flex; flex-direction: column; gap: 15px; padding: 15px;">
            <input type="hidden" id="event-fecha" value="${fecha}">
            
            <div class="form-group">
                <label class="form-label">Título del Evento</label>
                <input type="text" id="event-titulo" placeholder="Ej: Reunión de Padres" required class="form-input">
            </div>

            <div class="form-group">
                <label class="form-label">Categoría</label>
                <select id="event-categoria" class="form-input" style="height: 42px; cursor: pointer;">
                    <option value="General">General</option>
                    <option value="PP.FF.">PP.FF.</option>
                    <option value="Estudiantes">Estudiantes</option>
                    <option value="Personal Laboral">Personal Laboral</option>
                </select>
            </div>

            <div class="form-group">
                <label class="form-label">Descripción</label>
                <textarea id="event-descripcion" rows="4" placeholder="Escribe aquí los detalles del evento..." class="form-input" style="resize:none; padding-top: 10px; min-height: 80px;"></textarea>
            </div>

            <button type="button" onclick="procesarGuardarEvento()" class="btn-primary" style="width: 100%; margin-top: 10px; height: 45px;">
                <i class="material-icons">save</i> GUARDAR EVENTO
            </button>
        </form>
    `;
    
    document.getElementById('modal-global').style.display = 'flex';
}

async function procesarGuardarEvento() {
    console.log("Iniciando proceso de guardado..."); // Diagnóstico 1
    
    const btn = document.querySelector('#form-evento .btn-primary');
    
    // Captura de datos
    const fecha = document.getElementById('event-fecha').value;
    const titulo = document.getElementById('event-titulo').value.trim();
    const categoria = document.getElementById('event-categoria').value;
    const descripcion = document.getElementById('event-descripcion').value.trim();

    console.log("Datos capturados:", { fecha, titulo, categoria, descripcion, anioActivoID }); // Diagnóstico 2

    if (!titulo) {
        lanzarNotificacion('error', 'CAMPO VACÍO', 'El título es obligatorio.');
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="material-icons rotate">sync</i> GUARDANDO...';

        const res = await sendRequest('save_event', {
            fecha: fecha,
            titulo: titulo,
            categoria: categoria,
            descripcion: descripcion,
            idAnio: anioActivoID
        });

        console.log("Respuesta del servidor:", res); // Diagnóstico 3

        if (res && res.status === 'success') {
            lanzarNotificacion('success', 'REGISTRADO', res.message);
            cerrarModal();
            // CAMBIO CLAVE: Primero descargamos los eventos nuevos, luego redibujamos
            await cargarEventosDelServidor();
            // Refrescamos el calendario para Etapa 3
            renderizarCalendario();
        } else {
            lanzarNotificacion('error', 'SISTEMA', res ? res.message : 'Error desconocido');
        }
    } catch (e) {
        console.error("Error atrapado:", e); // Diagnóstico 4
        lanzarNotificacion('error', 'CONEXIÓN', 'No se pudo conectar con el servidor.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="material-icons">save</i> GUARDAR EVENTO';
        }
    }
}

// 1. Función para cargar eventos desde el servidor
async function cargarEventosDelServidor() {
    if (!anioActivoID) {
        console.warn("⚠️ No hay un año activo seleccionado para cargar eventos.");
        return;
    }
    
    try {
        // 1. Petición al servidor
        const res = await sendRequest('get_events', { idAnio: anioActivoID });
        
        if (res && res.status === 'success') {
            // 2. Actualizamos la memoria local (Caché)
            cacheEventosCalendario = res.eventos || [];
            console.log("📅 Eventos sincronizados:", cacheEventosCalendario.length);

            // 3. Verificamos si el calendario existe en el DOM antes de redibujar
            // Esto evita errores si el usuario cambió de módulo mientras cargaba
            const grid = document.getElementById('calendar-body-grid');
            if (grid) {
                renderizarCalendario();
            }
        }
    } catch (e) {
        console.error("❌ Error crítico cargando eventos:", e);
        lanzarNotificacion('error', 'CALENDARIO', 'No se pudo sincronizar los eventos.');
    }
}

function mostrarDetalleEventos(eventos, fecha) {
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    modalTitle.innerText = "Eventos del " + fecha;
    
    let htmlEventos = eventos.map(ev => `
        <div style="background: #f8fafc; padding: 12px; border-radius: 10px; border-left: 4px solid #2563eb; margin-bottom: 10px; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: start; padding-right: 30px;">
                <strong style="color: #1e293b; font-size: 1rem;">${ev.titulo}</strong>
                <span class="badge" style="font-size: 0.7rem; background: #e0f2fe; color: #0369a1;">${ev.categoria}</span>
            </div>
            <p style="margin: 5px 0 0; font-size: 0.85rem; color: #64748b;">${ev.descripcion || 'Sin descripción'}</p>
            
            <button onclick="confirmarEliminarEvento('${ev.id}', '${ev.titulo}')" 
                    style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #f87171; cursor: pointer;">
                <i class="material-icons" style="font-size: 18px;">delete_outline</i>
            </button>
        </div>
    `).join('');

    modalBody.innerHTML = `
        <div style="padding: 10px;">
            ${htmlEventos}
            <button onclick="abrirModalEvento('${fecha}')" class="btn-secondary" style="width: 100%; margin-top: 10px; border: 2px dashed #cbd5e1; background: transparent; color: #64748b;">
                <i class="material-icons" style="vertical-align:middle; font-size: 18px;">add</i> AGREGAR OTRO EVENTO
            </button>
        </div>
    `;
    document.getElementById('modal-global').style.display = 'flex';
}


// Paso 1: Mostrar confirmación con estilo WebApp
function confirmarEliminarEvento(id, titulo) {
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    
    modalTitle.innerText = "Confirmar Eliminación";
    
    modalBody.innerHTML = `
        <div class="fade-in" style="text-align: center; padding: 20px;">
            <div style="background: #fee2e2; color: #ef4444; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
                <i class="material-icons" style="font-size: 35px;">delete_forever</i>
            </div>
            <p style="color: #1e293b; font-weight: bold; font-size: 1.1rem; margin-bottom: 10px;">¿Eliminar este evento?</p>
            <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 25px;">"${titulo}"</p>
            
            <div style="display: flex; gap: 10px;">
                <button onclick="cerrarModal()" class="btn-secondary" style="flex: 1;">CANCELAR</button>
                <button id="btn-eliminar-confirm" onclick="procesarEliminarEvento('${id}')" class="btn-primary" style="flex: 1; background: #ef4444;">
                    ELIMINAR AHORA
                </button>
            </div>
        </div>
    `;
}

// Paso 2: Procesar con animación de carga
async function procesarEliminarEvento(id) {
    const btn = document.getElementById('btn-eliminar-confirm');
    
    try {
        // Activamos animación de carga en el botón
        btn.disabled = true;
        btn.innerHTML = '<i class="material-icons rotate">sync</i> ELIMINANDO...';

        const res = await sendRequest('delete_event', { id: id });
        
        if (res.status === 'success') {
            lanzarNotificacion('success', 'ELIMINADO', 'El evento ha sido borrado.');
            cerrarModal();
            // Actualización silenciosa de los datos y el calendario
            await cargarEventosDelServidor(); 
            if (typeof actualizarCacheDashboardSilencioso === 'function') {
                actualizarCacheDashboardSilencioso();
            }
        } else {
            lanzarNotificacion('error', 'ERROR', res.message);
            btn.disabled = false;
            btn.innerHTML = 'ELIMINAR AHORA';
        }
    } catch (e) {
        console.error(e);
        lanzarNotificacion('error', 'SISTEMA', 'No se pudo conectar con el servidor.');
        btn.disabled = false;
        btn.innerHTML = 'ELIMINAR AHORA';
    }
}



/*----------------------------VALIDACIÓN DE DISPOSITIVOS---------------------*/
/* --- SCRIPT.JS: VISTA DE DISPOSITIVOS --- */

/* --- SCRIPT.JS: VISTA DE DISPOSITIVOS CORREGIDA --- */

async function renderDispositivosView() {
    const content = document.getElementById('content-area'); 
    if (!content) return;

    const pcActualID = localStorage.getItem('newton_device_token') || 'NO REGISTRADA';

    // 1. Pintamos la estructura base (esto se queda fijo)
    content.innerHTML = `
        <div class="view-container fade-in">
            <div class="view-header">
                <div>
                    <h2 class="view-title">Gestión de Dispositivos</h2>
                    <p class="view-subtitle">Control de acceso físico al sistema</p>
                </div>
            </div>

            <div class="dash-card pc-identificadora" style="margin-bottom: 20px; border-left: 4px solid #2563eb; background: #f8fafc;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <i class="material-icons" style="color: #2563eb; font-size: 30px;">phonelink_setup</i>
                    <div>
                        <span style="display:block; font-size: 0.8rem; color:#64748b; font-weight: 600; text-transform: uppercase;">ID de esta computadora</span>
                        <code style="font-size: 1.1rem; color: #1e293b; font-family: 'Courier New', monospace; font-weight: bold;">${pcActualID}</code>
                    </div>
                </div>
            </div>

            <div class="dash-card">
                <table class="main-table">
                    <thead>
                        <tr>
                            <th>ID Dispositivo</th>
                            <th>Nombre Asignado</th>
                            <th>Estado</th>
                            <th style="text-align:right;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="body-dispositivos">
                        <tr><td colspan="4" style="text-align:center; padding:20px;">
                            <i class="material-icons rotate" style="vertical-align: middle;">sync</i> Cargando...
                        </td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // 2. Llamamos a los datos
    cargarTablaDispositivos();
}

async function cargarTablaDispositivos() {
    try {
        const res = await sendRequest('get_dispositivos');
        const tbody = document.getElementById('body-dispositivos');
        
        if (!tbody) return;

        if (res.status === 'success') {
            if (res.dispositivos.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">No hay dispositivos registrados.</td></tr>';
                return;
            }

            tbody.innerHTML = res.dispositivos.map(d => {
                // Configuración dinámica según el estado
                const isPendiente = d.estado === 'PENDIENTE';
                const isActivo = d.estado === 'ACTIVO';
                
                // Definir colores del Badge
                let badgeBg = isActivo ? '#dcfce7' : (isPendiente ? '#fef3c7' : '#fee2e2');
                let badgeColor = isActivo ? '#166534' : (isPendiente ? '#92400e' : '#991b1b');
                
                // Definir acción del botón principal
                const iconoAccion = isActivo ? 'block' : 'check_circle';
                const tituloAccion = isPendiente ? 'Aprobar Acceso' : (isActivo ? 'Desactivar' : 'Activar');
                const proximoEstado = isActivo ? 'INACTIVO' : 'ACTIVO';

                return `
                <tr style="${isPendiente ? 'background-color: #fffbeb;' : ''}">
                    <td>
                        <small style="font-family: monospace; color:#64748b; font-weight: bold;">${d.id}</small>
                        ${isPendiente ? '<br><span style="font-size: 10px; color: #b45309; font-weight: bold;">⚠️ SOLICITUD NUEVA</span>' : ''}
                    </td>
                    <td><strong>${d.nombre}</strong></td>
                    <td>
                        <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; border: 1px solid rgba(0,0,0,0.05);">
                            ${d.estado}
                        </span>
                    </td>
                    <td style="text-align:right;">
                        <div style="display: flex; justify-content: flex-end; gap: 5px;">
                            <button onclick="cambiarEstadoPC('${d.id}', '${proximoEstado}')" 
                                    class="btn-icon-small" 
                                    style="color: ${isPendiente ? '#b45309' : (isActivo ? '#64748b' : '#166534')};"
                                    title="${tituloAccion}">
                                <i class="material-icons">${iconoAccion}</i>
                            </button>
                            <button onclick="eliminarPC('${d.id}')" 
                                    class="btn-icon-small" 
                                    style="color: #ef4444;"
                                    title="Eliminar permanentemente">
                                <i class="material-icons">delete</i>
                            </button>
                        </div>
                    </td>
                </tr>
                `;
            }).join('');
        }
    } catch (e) { 
        console.error("Error cargando dispositivos:", e); 
    }
}



async function cambiarEstadoPC(id, nuevoEstado) {
    if (!confirm(`¿Deseas cambiar el estado a ${nuevoEstado}?`)) return;
    
    try {
        const res = await sendRequest('update_dispositivo', { id, nuevoEstado });
        if (res.status === 'success') {
            lanzarNotificacion('success', 'ACTUALIZADO', res.message);
            cargarTablaDispositivos();
        }
    } catch (e) { console.error(e); }
}

/* --- ACTUALIZAR EN SCRIPT.JS --- */

async function eliminarPC(id) {
    if (!confirm("⚠️ ¿Estás seguro de eliminar este dispositivo? Deberás registrarlo de nuevo para que pueda acceder.")) return;
    
    try {
        const res = await sendRequest('delete_dispositivo', { id: id });
        if (res.status === 'success') {
            lanzarNotificacion('success', 'ELIMINADO', res.message);
            cargarTablaDispositivos(); // Recargamos la tabla
        }
    } catch (e) { console.error(e); }
}

// Asegúrate de que el mapeo de tu tabla en cargarTablaDispositivos incluya esto:
// <button onclick="eliminarPC('${d.id}')" class="btn-icon-small btn-danger" title="Eliminar">
//     <i class="material-icons">delete</i>
// </button>

// Función para enviar la solicitud de accesoa de dispositivo
/* --- EN SCRIPT.JS --- */

async function enviarSolicitudAcceso(idRecibido) {
    const inputNombre = document.getElementById('nombre-pc-solicitud');
    const msg = document.getElementById('login-msg');
    
    // 1. Validar que escribió un nombre
    const nombrePc = inputNombre.value.trim();
    if (!nombrePc) {
        alert("Por favor, dale un nombre a esta computadora (ej: Laptop de Juan)");
        inputNombre.focus();
        return;
    }

    // 2. Feedback visual en el botón
    const btn = document.querySelector('#login-msg .btn-primary');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="material-icons rotate">sync</i> ENVIANDO...';

    try {
        // 3. Llamada al servidor
        const response = await sendRequest('solicitar_acceso', { 
            id: idRecibido, 
            nombre: nombrePc 
        });

        if (response.status === 'success') {
            msg.innerHTML = `
                <div style="background: #dcfce7; color: #166534; padding: 15px; border-radius: 10px; border: 1px solid #bbf7d0;">
                    <i class="material-icons" style="vertical-align: bottom;">check_circle</i> 
                    <strong>¡Solicitud enviada!</strong><br>
                    Espera a que el administrador la apruebe.
                </div>
            `;
        } else {
            alert(response.message);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    } catch (error) {
        console.error("Error al solicitar acceso:", error);
        alert("Error de conexión al enviar la solicitud.");
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/*------------------------------------------------------------------------*/
/* --- FUNCIÓN PARA GENERAR REPORTE A4 --- */

function imprimirListaSeccion() {
    // 1. Capturar datos de encabezado
    const comboAnio = document.getElementById('con-anio');
    const comboNivel = document.getElementById('con-nivel');
    const comboGrado = document.getElementById('con-grado');
    const comboSeccion = document.getElementById('con-seccion');

    const anio = comboAnio.options[comboAnio.selectedIndex]?.text || '';
    const nivel = comboNivel.options[comboNivel.selectedIndex]?.text || '';
    const grado = comboGrado.options[comboGrado.selectedIndex]?.text || '';
    const seccion = comboSeccion.options[comboSeccion.selectedIndex]?.text || '';

    // 2. Capturar filas
    const filasRaw = document.querySelectorAll('#body-lista-seccion tr');
    
    if (filasRaw.length === 0 || filasRaw[0].innerText.includes('Seleccione') || filasRaw[0].innerText.includes('No se encontraron')) {
        lanzarNotificacion('error', 'SIN DATOS', 'Primero carga una lista de estudiantes para imprimir.');
        return;
    }

    // --- LÓGICA DE ORDENAMIENTO ---
    let estudiantes = [];
    filasRaw.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length > 2) { 
            estudiantes.push({
                // Solo necesitamos el nombre para ordenar e imprimir
                nombre: tds[2].innerText.trim() 
            });
        }
    });

    // Ordenar alfabéticamente (A-Z)
    estudiantes.sort((a, b) => a.nombre.localeCompare(b.nombre));

    // 3. Configuración de columnas (SIN DNI -> MÁS ESPACIO)
    // Aumentamos a 12 columnas (Ideal para asistencia de 2 semanas o muchas notas)
    const numColumnasVacias = 12; 
    let thVacios = '';
    let tdVacios = '';

    for(let i=0; i<numColumnasVacias; i++) {
        // Encabezado vacío (con borde para que el profesor escriba la fecha o criterio)
        thVacios += `<th class="casillero"></th>`; 
        tdVacios += `<td class="casillero"></td>`; 
    }

    // 4. Construir filas HTML
    let filasHTML = '';
    
    estudiantes.forEach((est, index) => {
        filasHTML += `
            <tr>
                <td class="col-nro">${index + 1}</td>
                <td class="col-nombre">${est.nombre}</td>
                ${tdVacios}
            </tr>
        `;
    });

    // 5. Generar PDF Vertical Optimizado
    const ventana = window.open('', '_blank');
    ventana.document.write(`
        <html>
        <head>
            <title>Lista ${grado} ${seccion}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
                
                body { 
                    font-family: 'Roboto', sans-serif; 
                    padding: 0; 
                    margin: 0;
                    font-size: 11px; 
                    color: #1e293b;
                }
                
                /* CABECERA */
                .header-container {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 2px solid #2563eb;
                    padding-bottom: 5px;
                    margin-bottom: 10px;
                }
                .titulo-principal {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e3a8a;
                    margin: 0;
                }
                .subtitulo { font-size: 10px; color: #64748b; margin: 0; }

                /* CAJA DE DATOS */
                .info-box {
                    background-color: #eff6ff; 
                    border: 1px solid #bfdbfe;
                    border-radius: 4px;
                    padding: 6px 10px;
                    display: flex;
                    justify-content: space-between;
                    font-weight: bold;
                    color: #1e40af;
                    margin-bottom: 10px;
                    font-size: 11px;
                }

                /* TABLA */
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    table-layout: fixed; 
                }
                
                th {
                    background-color: #2563eb; 
                    color: white;
                    padding: 4px 2px;
                    border: 1px solid #1e40af;
                    font-weight: 600;
                    font-size: 9px;
                    text-align: center;
                    height: 20px; /* Espacio para escribir fecha en el encabezado */
                }

                td {
                    border: 1px solid #94a3b8; /* Borde visible para guiar la escritura */
                    padding: 3px 5px;
                    font-size: 10px;
                    height: 18px; 
                }

                /* ANCHOS DE COLUMNAS (Total 100%) */
                .col-nro { 
                    width: 4%; 
                    text-align: center; 
                    background: #f1f5f9; 
                    font-weight: bold;
                }
                
                .col-nombre { 
                    width: 36%; /* Espacio suficiente para apellidos largos */
                    text-align: left;
                    white-space: nowrap; 
                    overflow: hidden; 
                    text-overflow: ellipsis; 
                    text-transform: uppercase;
                }

                /* El 60% restante se divide entre las 12 columnas vacías (5% c/u) */
                .casillero { width: 5%; }

                /* EFECTO CEBRA SUAVE */
                tr:nth-child(even) { background-color: #f8fafc; }

                @media print {
                    @page { 
                        size: A4 portrait; 
                        margin: 8mm 10mm; /* Márgenes ajustados para aprovechar la hoja */
                    }
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div>
                    <h1 class="titulo-principal">I.E.P. NEWTON SCHOOL</h1>
                    <p class="subtitulo">Registro Auxiliar de Evaluación y Asistencia</p>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:12px; font-weight:bold; color:#1e3a8a;">${grado} "${seccion}"</div>
                    <div style="font-size:9px;">${new Date().toLocaleDateString()}</div>
                </div>
            </div>

            <div class="info-box">
                <span>AÑO: ${anio}</span>
                <span>NIVEL: ${nivel}</span>
                <span>TOTAL ESTUDIANTES: ${estudiantes.length}</span>
            </div>

            <table>
                <thead>
                    <tr>
                        <th class="col-nro">N°</th>
                        <th class="col-nombre">APELLIDOS Y NOMBRES</th>
                        ${thVacios}
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>
            
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    ventana.document.close();
}

/*-------------------------------------------------------------------*/
/* --- AÑADIR AL MODULO DE REPORTES O CAJA EN SCRIPT.JS --- */

let cacheReportePagos = {}; // Para guardar los datos descargados
let tabReporteActual = 'REGULAR'; // 'REGULAR' o 'ADICIONAL'

/* --- REEMPLAZA TU FUNCIÓN ACTUAL CON ESTA VERSIÓN ROBUSTA --- */

function renderReportesPagosView() {
    // 1. Verificar Permisos
    if (!['ADMINISTRADOR', 'SECRETARIA', 'DIRECTIVO'].includes(currentUser.role)) {
        lanzarNotificacion('error', 'ACCESO DENEGADO', 'No tienes permisos para ver reportes financieros.');
        return;
    }

    // 2. CORRECCIÓN CRÍTICA: Resetear siempre a 'REGULAR' al abrir para evitar desincronización
    tabReporteActual = 'REGULAR'; 

    const content = document.getElementById('content-area');
    content.innerHTML = `
        <div class="module-header">
            <h2>Reporte de Pagos y Deudas</h2>
            <p>Estado de cuenta por sección y concepto.</p>
        </div>

        <div class="tabs-container" style="margin-bottom: 20px; display: flex; gap: 15px;">
            
            <button id="btn-tab-reg" class="tab-button active" onclick="cambiarTabReporte('REGULAR')" 
                    style="flex: 1; padding: 15px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.2s;">
                <i class="material-icons" style="font-size: 24px;">school</i> 
                <span>CONCEPTOS REGULARES</span>
            </button>
            
            <button id="btn-tab-adi" class="tab-button" onclick="cambiarTabReporte('ADICIONAL')" 
                    style="flex: 1; padding: 15px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.2s;">
                <i class="material-icons" style="font-size: 24px;">local_activity</i> 
                <span>CONCEPTOS ADICIONALES</span>
            </button>

        </div>

        <div class="card-config" style="background:white; padding:15px; border-radius:12px; margin-bottom:20px; border-left: 4px solid #2563eb;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; align-items: flex-end;">
                
                <div>
                    <label class="form-label">Año Académico</label>
                    <select id="rep-anio" class="form-input" disabled>
                        <option value="${anioActivoID}">${anioActivoNombre}</option>
                    </select>
                </div>
                
                <div><label class="form-label">Nivel</label><select id="rep-nivel" class="form-input" onchange="alCambiarNivelReporte()"></select></div>
                <div><label class="form-label">Grado</label><select id="rep-grado" class="form-input" onchange="alCambiarGradoReporte()"></select></div>
                <div><label class="form-label">Sección</label><select id="rep-seccion" class="form-input" onchange="alCambiarSeccionReporte()"></select></div>
                
                <div style="flex-grow: 2;">
                    <label class="form-label" style="color:#2563eb;">Concepto a Evaluar</label>
                    <select id="rep-concepto" class="form-input" style="font-weight:bold; border-color:#2563eb;" onchange="generarReporteDeuda()"></select>
                </div>

            </div>
        </div>

        <div class="report-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">
            <div class="dash-card" style="border-top: 4px solid #ef4444; padding:0; overflow:hidden;">
                <div style="padding:15px; background:#fef2f2; border-bottom:1px solid #fee2e2; display:flex; justify-content:space-between;">
                    <strong style="color:#991b1b;">PENDIENTES DE PAGO</strong>
                    <span id="count-deuda" class="badge" style="background:#fee2e2; color:#991b1b;">0</span>
                </div>
                <div class="table-container" style="max-height: 500px; overflow-y: auto;">
                    <table class="data-table">
                        <thead><tr><th>Estudiante</th><th style="text-align:right;">Deuda</th></tr></thead>
                        <tbody id="body-deuda"><tr><td colspan="2" style="text-align:center; color:#94a3b8;">Seleccione concepto...</td></tr></tbody>
                    </table>
                </div>
            </div>

            <div class="dash-card" style="border-top: 4px solid #10b981; padding:0; overflow:hidden;">
                <div style="padding:15px; background:#f0fdf4; border-bottom:1px solid #dcfce7; display:flex; justify-content:space-between;">
                    <strong style="color:#166534;">AL DÍA (PAGADO)</strong>
                    <span id="count-pagado" class="badge" style="background:#dcfce7; color:#166534;">0</span>
                </div>
                <div class="table-container" style="max-height: 500px; overflow-y: auto;">
                    <table class="data-table">
                        <thead><tr><th>Estudiante</th><th>Recibo</th></tr></thead>
                        <tbody id="body-pagado"><tr><td colspan="2" style="text-align:center; color:#94a3b8;">Esperando datos...</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Cargar datos
    cargarDatosInicialesReporte();
}

async function cargarDatosInicialesReporte() {
    // 1. Cargar los niveles desde la memoria global
    actualizarSelectsNivelGradoReporte(); 

    // 2. Traer la data financiera del servidor
    try {
        const res = await sendRequest('get_reporte_pagos', { idAnio: anioActivoID });
        if (res.status === 'success') {
            cacheReportePagos = res;
            actualizarComboConceptos(); // Llenar conceptos según la pestaña activa
        }
    } catch (e) { console.error(e); }
}

/* --- REEMPLAZA LA FUNCIÓN cambiarTabReporte --- */

function cambiarTabReporte(tipo) {
    // 1. Actualizar variable global
    tabReporteActual = tipo;

    // 2. Referencias a los botones
    const btnReg = document.getElementById('btn-tab-reg');
    const btnAdi = document.getElementById('btn-tab-adi');

    // 3. Gestión visual manual (Más segura que togglear clases genéricas)
    if (tipo === 'REGULAR') {
        btnReg.classList.add('active');
        btnAdi.classList.remove('active');
    } else {
        btnReg.classList.remove('active');
        btnAdi.classList.add('active');
    }

    // 4. Lógica de datos
    actualizarComboConceptos();
    
    // 5. Limpieza visual de tablas
    // Es mejor limpiar los resultados al cambiar de pestaña para no confundir datos
    limpiarResultadosReporte();
}

function actualizarComboConceptos() {
    const select = document.getElementById('rep-concepto');
    select.innerHTML = '<option value="">-- Seleccione --</option>';
    
    if (!cacheReportePagos.conceptos) return;

    // Filtramos conceptos por el tipo de la pestaña actual
    const filtrados = cacheReportePagos.conceptos.filter(c => c.tipo === tabReporteActual);
    
    select.innerHTML += filtrados.map(c => 
        `<option value="${c.id}" data-monto="${c.monto}">${c.nombre} (S/ ${c.monto})</option>`
    ).join('');
}

function generarReporteDeuda() {
    const idSec = document.getElementById('rep-seccion').value;
    const idCon = document.getElementById('rep-concepto').value;
    
    const bodyDeuda = document.getElementById('body-deuda');
    const bodyPagado = document.getElementById('body-pagado');
    const countDeuda = document.getElementById('count-deuda');
    const countPagado = document.getElementById('count-pagado');

    if (!idSec || !idCon) {
        bodyDeuda.innerHTML = '<tr><td colspan="2" style="text-align:center;">Faltan filtros</td></tr>';
        bodyPagado.innerHTML = '<tr><td colspan="2" style="text-align:center;">Faltan filtros</td></tr>';
        return;
    }

    // 1. Obtener precio base del concepto
    const conceptoObj = cacheReportePagos.conceptos.find(c => String(c.id) === String(idCon));
    const precioBase = conceptoObj ? parseFloat(conceptoObj.monto) : 0;

    // 2. Obtener alumnos de la sección
    const matriculados = cacheReportePagos.matriculas.filter(m => String(m.idSec) === String(idSec));

    let listaDeuda = [];
    let listaPagado = [];

    // 3. PROCESAR CADA ALUMNO
    matriculados.forEach(mat => {
        const est = cacheReportePagos.estudiantes.find(e => String(e.id) === String(mat.idEst));
        if (!est) return;

        // A. Calcular Descuentos
        const misDescuentos = cacheReportePagos.descuentos
            .filter(d => String(d.idEst) === String(mat.idEst) && String(d.idCon) === String(idCon));
        const totalDescuento = misDescuentos.reduce((sum, d) => sum + parseFloat(d.monto), 0);

        // B. Calcular Pagos Realizados
        const misPagos = cacheReportePagos.pagos
            .filter(p => String(p.idEst) === String(mat.idEst) && String(p.idCon) === String(idCon));
        const totalPagado = misPagos.reduce((sum, p) => sum + parseFloat(p.monto), 0);

        // C. Calcular Deuda Final
        const montoA_Pagar = precioBase - totalDescuento;
        const deuda = montoA_Pagar - totalPagado;

        const ultimoRecibo = misPagos.length > 0 ? misPagos[misPagos.length - 1].recibo : '---';

        // D. Clasificar (Margen de error de 0.1 para decimales)
        if (deuda > 0.1) {
            listaDeuda.push({ nombre: est.nombre, deuda: deuda });
        } else {
            listaPagado.push({ nombre: est.nombre, recibo: misPagos.length > 1 ? 'Varios' : ultimoRecibo });
        }
    });

    // 4. Renderizar DEUDORES
    listaDeuda.sort((a,b) => a.nombre.localeCompare(b.nombre));
    countDeuda.innerText = listaDeuda.length;
    bodyDeuda.innerHTML = listaDeuda.length ? listaDeuda.map(item => `
        <tr>
            <td style="font-size:12px;">${item.nombre}</td>
            <td style="text-align:right; font-weight:bold; color:#ef4444;">S/ ${item.deuda.toFixed(2)}</td>
        </tr>
    `).join('') : '<tr><td colspan="2" style="text-align:center; color:#166534;"><i class="material-icons">check</i> Nadie debe</td></tr>';

    // 5. Renderizar PAGADOS
    listaPagado.sort((a,b) => a.nombre.localeCompare(b.nombre));
    countPagado.innerText = listaPagado.length;
    bodyPagado.innerHTML = listaPagado.length ? listaPagado.map(item => `
        <tr>
            <td style="font-size:12px;">${item.nombre}</td>
            <td style="text-align:center; font-family:monospace; color:#166534; background:#dcfce7; border-radius:4px; padding:2px;">${item.recibo}</td>
        </tr>
    `).join('') : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Nadie ha pagado</td></tr>';
}

/* FUNCIONES AUXILIARES PARA LOS SELECTS (Si no las tienes globales) */
/* --- LOGICA DE FILTROS EN CASCADA (Usando seccionesGlobal) --- */

// 1. Carga inicial de Niveles (se llama al abrir la vista)
function actualizarSelectsNivelGradoReporte() {
    const selectNivel = document.getElementById('rep-nivel');
    const selectGrado = document.getElementById('rep-grado');
    const selectSeccion = document.getElementById('rep-seccion');

    // Limpieza inicial
    selectNivel.innerHTML = '<option value="">-- Seleccione Nivel --</option>';
    selectGrado.innerHTML = '<option value="">-- Primero Nivel --</option>';
    selectSeccion.innerHTML = '<option value="">-- Primero Grado --</option>';

    if (!seccionesGlobal || seccionesGlobal.length === 0) {
        console.warn("No hay secciones globales cargadas.");
        return;
    }

    // Extraer niveles únicos (Set elimina duplicados)
    const nivelesUnicos = [...new Set(seccionesGlobal.map(s => s.nivel))];

    // Llenar el combo
    nivelesUnicos.forEach(nivel => {
        selectNivel.innerHTML += `<option value="${nivel}">${nivel}</option>`;
    });
}

// 2. Al cambiar Nivel -> Carga Grados
function alCambiarNivelReporte() {
    const nivelSel = document.getElementById('rep-nivel').value;
    const selectGrado = document.getElementById('rep-grado');
    const selectSeccion = document.getElementById('rep-seccion');

    // Resetear hijos
    selectGrado.innerHTML = '<option value="">-- Seleccione Grado --</option>';
    selectSeccion.innerHTML = '<option value="">-- Primero Grado --</option>';
    limpiarResultadosReporte(); // Borrar tablas para evitar confusión

    if (!nivelSel) return;

    // Filtrar grados que pertenecen a ese nivel
    const gradosDelNivel = seccionesGlobal
        .filter(s => s.nivel === nivelSel)
        .map(s => s.grado);
    
    // Quitar duplicados
    const gradosUnicos = [...new Set(gradosDelNivel)];

    gradosUnicos.forEach(grado => {
        selectGrado.innerHTML += `<option value="${grado}">${grado}</option>`;
    });
}

// 3. Al cambiar Grado -> Carga Secciones (IDs reales)
function alCambiarGradoReporte() {
    const nivelSel = document.getElementById('rep-nivel').value;
    const gradoSel = document.getElementById('rep-grado').value;
    const selectSeccion = document.getElementById('rep-seccion');

    // Resetear hijo
    selectSeccion.innerHTML = '<option value="">-- Seleccione Sección --</option>';
    limpiarResultadosReporte(); 

    if (!nivelSel || !gradoSel) return;

    // Filtrar secciones exactas
    const seccionesFinales = seccionesGlobal.filter(s => s.nivel === nivelSel && s.grado === gradoSel);

    seccionesFinales.forEach(sec => {
        // Aquí el VALUE es el ID de la sección (necesario para buscar deudas)
        selectSeccion.innerHTML += `<option value="${sec.id}">${sec.nombre}</option>`;
    });
}

// 4. Función de limpieza visual (UX)
function limpiarResultadosReporte() {
    document.getElementById('body-deuda').innerHTML = '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Seleccione filtros y concepto...</td></tr>';
    document.getElementById('body-pagado').innerHTML = '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Esperando datos...</td></tr>';
    document.getElementById('count-deuda').innerText = '0';
    document.getElementById('count-pagado').innerText = '0';
}

/* --- AGREGAR A SCRIPT.JS --- */
// 1. Función disparadora al seleccionar una sección
function alCambiarSeccionReporte() {
    limpiarResultadosReporte(); // Borra la tabla de deudores antigua
    actualizarComboConceptos(); // Carga los conceptos específicos de esta sección
}

// 2. Función de filtrado actualizada
/* --- EN SCRIPT.JS --- */

function actualizarComboConceptos() {
    const select = document.getElementById('rep-concepto');
    
    // Capturamos el ID de la sección seleccionada y lo limpiamos (sin espacios)
    const idSecValor = document.getElementById('rep-seccion').value;
    const idSec = idSecValor ? String(idSecValor).trim() : "";

    select.innerHTML = '<option value="">-- Seleccione Concepto --</option>';
    
    // Seguridad: Si no hay datos o no hay sección seleccionada, paramos.
    if (!cacheReportePagos.conceptos || !idSec) {
        console.log("Esperando selección de sección...");
        return;
    }

    const filtrados = cacheReportePagos.conceptos.filter(c => {
        // 1. FILTRO POR TIPO (Pestaña) - Comparación insensible a mayúsculas/minúsculas
        const tipoConcepto = (c.tipo || "").trim().toUpperCase();
        const tipoPestaña = (tabReporteActual || "").trim().toUpperCase();
        
        if (tipoConcepto !== tipoPestaña) return false;

        // 2. FILTRO POR ID SECCIÓN (Estricto)
        // Convertimos la celda "ID1, ID2, ID3" en un array limpio
        const stringIds = String(c.idsSecciones || "");
        
        // Separamos por coma y limpiamos cada ID individualmente
        const arrayIds = stringIds.split(',').map(id => id.trim());
        
        // Verificamos si el ID de MI sección está en esa lista
        return arrayIds.includes(idSec);
    });
    
    // Debug para que verifiques en consola si sigue fallando
    console.log(`Filtro aplicado: Sección [${idSec}] | Pestaña [${tabReporteActual}] | Encontrados: ${filtrados.length}`);

    if (filtrados.length > 0) {
        select.innerHTML += filtrados.map(c => 
            `<option value="${c.id}" data-monto="${c.monto}">${c.nombre} (S/ ${c.monto})</option>`
        ).join('');
    } else {
        select.innerHTML = '<option value="">-- Sin conceptos para esta sección --</option>';
    }
}


/*------DESCARGAR TICKET PDF------------------*/
function descargarTicketPDF(datosBorrador, nroRecibo) {
    lanzarNotificacion('loading', 'PDF', 'Generando archivo...');

    // 1. Datos Generales
    // Si datosBorrador[0].fecha existe (viene del buscador), la usamos.
    // Si no existe (es un recibo nuevo), generamos la fecha actual.
    const fechaEmision = datosBorrador[0].fecha && datosBorrador[0].fecha !== "---" 
        ? datosBorrador[0].fecha 
        : new Date().toLocaleString('es-PE', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
          });
    // -----------------------
    const medioDigital = datosBorrador[0].medio;
    const codOp = datosBorrador[0].codOp;
    const obs = datosBorrador[0].obs;
    const granTotal = datosBorrador.reduce((sum, it) => sum + parseFloat(it.totalInd), 0);
    const logoUrl = 'https://i.postimg.cc/W45SpCYb/insignia-azul-sello.png';

    // 2. Construir el Contenedor
    const element = document.createElement('div');
    element.style.width = '260px'; 
    element.style.fontFamily = "'Courier New', Courier, monospace";
    element.style.fontSize = '11px';
    element.style.padding = '15px';
    element.style.color = '#000';
    element.style.backgroundColor = '#fff';

    let htmlContent = `
        <div style="text-align: center;">
            <img src="${logoUrl}" crossorigin="anonymous" width="60" style="filter: grayscale(1); display: block; margin: 0 auto;"><br>
            <strong style="font-size: 12px;">I.E.P. Ciencias Aplicadas<br>Sir Isaac Newton</strong><br>
            <strong>RUC: 20455855226</strong><br>
            <span style="font-size: 9px;">Calle Aurelio de la Fuente N° 102-104</span><br>
            <div style="border-bottom: 1px dashed #000; margin: 5px 0;"></div>
            <strong style="font-size: 13px;">RECIBO N° ${nroRecibo}</strong><br>
            <span>Emisión: ${fechaEmision}</span>
        </div>
        <div style="border-bottom: 1px dashed #000; margin: 5px 0;"></div>
        <div style="font-weight: bold; margin-bottom: 8px;">DETALLE DE PAGO:</div>
    `;

    datosBorrador.forEach((it, idx) => {
        // --- LÓGICA DE CÁLCULO DE RETRASO ---
        let textoEstado = "";
        if (it.fechaProg) {
            const fechaProg = new Date(it.fechaProg);
            const hoy = new Date();
            
            // Normalizar a medianoche
            hoy.setHours(0,0,0,0);
            fechaProg.setHours(0,0,0,0);
            
            if (!isNaN(fechaProg.getTime())) {
                const diffTime = hoy - fechaProg;
                const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diasAtraso > 0) {
                    textoEstado = `<div style="font-weight:bold;">Días de retraso: ${diasAtraso}</div>`;
                } else {
                    textoEstado = `<div style="font-style:italic;">Pago puntual.</div>`;
                }
            }
        }

        const saldoRestante = (it.saldoPrevio || 0) - parseFloat(it.totalInd);
        const bloqueSaldo = (it.tipo !== 'EXCEPCIONAL') ? `
            <div style="font-size: 9px; margin-top: 2px;">SALDO PEND: S/ ${saldoRestante.toFixed(2)}</div>` : '';

        htmlContent += `
        <div style="margin-bottom: 10px;">
            <div style="font-weight:bold;">${idx + 1}. ${it.nombre}</div>
            <div style="padding-left: 5px; font-size: 10px;">
                > ${it.nomCon}<br>
                <span>Pagado: S/ ${parseFloat(it.totalInd).toFixed(2)}</span>
                <div style="border-left: 2px solid #000; padding-left: 5px; margin-top:2px; font-size: 9px;">
                   ${bloqueSaldo}
                   ${textoEstado}
                </div>
            </div>
        </div>`;
    });

    htmlContent += `
        <div style="border-bottom: 3px double #000; margin: 5px 0;"></div>
        <div style="text-align: center; font-size: 14px; font-weight: bold; border: 1px solid #000; padding: 5px;">
            TOTAL: S/ ${granTotal.toFixed(2)}
        </div>
    `;

    if (medioDigital && medioDigital.trim() !== "") {
        htmlContent += `
        <div style="margin-top: 10px; font-size: 9px; background: #eee; padding: 5px;">
            <strong>M. DIGITAL:</strong> ${medioDigital}<br>
            <strong>CÓD. OP:</strong> ${codOp}
        </div>`;
    }

    if (obs) {
        htmlContent += `<div style="margin-top: 8px; font-size: 9px;"><strong>OBS:</strong> ${obs}</div>`;
    }

    htmlContent += `
        <div style="border-bottom: 1px dashed #000; margin: 10px 0;"></div>
        <div style="text-align: center; font-size: 10px; margin-top: 10px;">
            ¡Gracias por su confianza!<br>
            <span style="font-size: 8px;">Copia digital generada por sistema.</span>
        </div>
    `;

    element.innerHTML = htmlContent;

    // 3. Configuración y Generación
    const opt = {
        margin:       [10, 5],
        filename:     `Recibo-${nroRecibo}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 3, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: [80, 250], orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        cerrarNotify();
        lanzarNotificacion('success', 'PDF GENERADO', 'Se descargó el archivo correctamente.');
    }).catch(err => {
        console.error(err);
        cerrarNotify();
        lanzarNotificacion('error', 'ERROR', 'Fallo al generar PDF.');
    });
}