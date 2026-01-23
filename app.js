document.addEventListener('DOMContentLoaded', function() {
    
    const loginForm = document.getElementById('loginForm');
    const btnLogin = document.getElementById('btnLogin');
    const btnText = document.getElementById('btnText');
    const loader = document.getElementById('loader');
    const messageArea = document.getElementById('messageArea');

    loginForm.addEventListener('submit', function(e) {
        e.preventDefault(); // Evita que la página se recargue

        // Obtenemos valores
        const user = document.getElementById('username').value;
        const pass = document.getElementById('password').value;

        // UI: Estado de "Cargando"
        setLoading(true);
        hideMessage();

        // AQUÍ CONECTAREMOS CON GOOGLE APPS SCRIPT LUEGO
        // Por ahora simulamos una espera de 1.5 segundos
        setTimeout(() => {
            console.log("Intentando login con:", user);
            
            // Simulación simple para probar visualmente
            if(user === "admin" && pass === "123") {
                // Aquí redirigiremos al Dashboard
                showMessage("¡Acceso Correcto! Redirigiendo...", "success");
            } else {
                showMessage("Usuario o contraseña incorrectos.", "error");
                setLoading(false);
            }
        }, 1500);
    });

    // Funciones de utilidad UI
    function setLoading(isLoading) {
        if (isLoading) {
            btnLogin.disabled = true;
            btnText.style.display = 'none';
            loader.classList.remove('hidden');
        } else {
            btnLogin.disabled = false;
            btnText.style.display = 'block';
            loader.classList.add('hidden');
        }
    }

    function showMessage(msg, type) {
        messageArea.textContent = msg;
        messageArea.className = 'message ' + type;
        messageArea.classList.remove('hidden');
    }

    function hideMessage() {
        messageArea.classList.add('hidden');
    }
});
