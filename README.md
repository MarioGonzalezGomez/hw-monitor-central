# 🖥 HW Monitor Central

Monitor web centralizado para visualizar información de hardware de múltiples equipos que ejecutan [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) con su servidor web activado.

![Python](https://img.shields.io/badge/Python-3.6+-blue?logo=python&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

## ✨ Características

- **Panel centralizado** — Monitoriza varios equipos desde una sola página web
- **Datos en tiempo real** — CPU temp/carga/potencia, GPU temp/carga, RAM, ventiladores
- **Alertas de temperatura** — Notificaciones toast cuando se superan umbrales configurables
- **Estética premium** — Dark mode, glassmorphism, micro-animaciones, tipografía moderna
- **Configuración externa** — Fichero `config.json` para añadir/quitar equipos sin tocar código
- **Auto-refresh** — Intervalo configurable (3s, 5s, 10s, 30s)
- **Panel de detalle** — Click en un equipo para ver todos los sensores en detalle
- **Sin dependencias** — Solo necesita Python 3.6+ (usa la librería estándar)

## 📋 Requisitos

- **Python 3.6+** instalado en la máquina donde se ejecuta el servidor
- **LibreHardwareMonitor** con el servidor web activado en los equipos a monitorizar
  - En LibreHardwareMonitor: `Options > Remote Web Server > Run`

## 🚀 Instalación y uso

### 1. Clonar el repositorio

```bash
git clone https://github.com/TU_USUARIO/hw-monitor-central.git
cd hw-monitor-central
```

### 2. Configurar equipos

Edita `config.json` y añade las IPs de tus equipos:

```json
{
    "machines": [
        { "name": "Equipo 1", "ip": "192.168.1.100", "port": 8085 },
        { "name": "Equipo 2", "ip": "192.168.1.101", "port": 8085 }
    ]
}
```

### 3. Iniciar el servidor

**Windows:** Doble clic en `start.bat`

**Manual (cualquier OS):**
```bash
python server.py
```

### 4. Abrir el dashboard

Navega a **http://localhost:3000** en tu navegador.

También puedes acceder desde cualquier equipo de tu red usando la IP del servidor.

## ⚙️ Configuración

El fichero `config.json` permite configurar:

| Sección | Parámetro | Descripción |
|---------|-----------|-------------|
| `server.port` | Puerto del servidor web | Default: `3000` |
| `refresh.defaultInterval` | Intervalo de refresco (ms) | Default: `5000` |
| `refresh.autoRefresh` | Auto-refresh al iniciar | Default: `true` |
| `thresholds.cpu.warn` | Umbral aviso CPU (°C) | Default: `75` |
| `thresholds.cpu.danger` | Umbral crítico CPU (°C) | Default: `85` |
| `thresholds.gpu.warn` | Umbral aviso GPU (°C) | Default: `70` |
| `thresholds.gpu.danger` | Umbral crítico GPU (°C) | Default: `85` |
| `machines[]` | Array de equipos | `name`, `ip`, `port` |

> 💡 Los cambios en `config.json` se aplican sin reiniciar el servidor. Solo recarga la página (F5).

## 🏗 Arquitectura

```
hw-monitor-central/
├── index.html      # Página principal del dashboard
├── styles.css      # Estilos CSS (dark mode, glassmorphism)
├── app.js          # Lógica de la aplicación (fetch, parsing, UI)
├── server.py       # Servidor proxy Python (evita CORS)
├── server.js       # Servidor proxy Node.js (alternativa)
├── config.json     # Configuración de equipos y umbrales
├── start.bat       # Lanzador para Windows
└── README.md
```

El servidor Python actúa como proxy entre el navegador y las instancias de LibreHardwareMonitor para evitar restricciones CORS del navegador.

## 📝 Licencia

MIT
