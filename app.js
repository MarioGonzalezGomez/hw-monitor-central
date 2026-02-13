/**
 * HW Monitor Central — Dashboard App
 * Centralized LibreHardwareMonitor viewer for multiple machines
 * Configuration is loaded from config.json via /api/config
 */

// ============================================================
// CONFIGURATION (loaded dynamically from config.json)
// ============================================================
let MACHINES = [];
let TEMP_THRESHOLDS = { warn: 75, danger: 85, max: 100 };
let GPU_TEMP_THRESHOLDS = { warn: 70, danger: 85, max: 100 };

// ============================================================
// STATE
// ============================================================
let machineData = {};
let refreshTimer = null;
let isAutoRefresh = true;
let refreshInterval = 5000;
let expandedPanels = new Set();
let previousTemps = {}; // for alert tracking

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    initControls();
    buildOverviewCards();
    buildDetailPanels();
    fetchAllData();
    startAutoRefresh();
});

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = await response.json();

        // Load machines
        const palette = ['#6366f1', '#06b6d4', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#14b8a6'];
        MACHINES = (config.machines || []).map((m, i) => ({
            id: m.id || `machine-${i + 1}`,
            name: m.name || `Equipo ${i + 1}`,
            ip: m.ip,
            port: m.port || 8085,
            color: m.color || palette[i % palette.length],
        }));

        // Load thresholds
        if (config.thresholds) {
            if (config.thresholds.cpu) TEMP_THRESHOLDS = { ...TEMP_THRESHOLDS, ...config.thresholds.cpu };
            if (config.thresholds.gpu) GPU_TEMP_THRESHOLDS = { ...GPU_TEMP_THRESHOLDS, ...config.thresholds.gpu };
        }

        // Load refresh settings
        if (config.refresh) {
            if (config.refresh.defaultInterval) {
                refreshInterval = config.refresh.defaultInterval;
                const select = document.getElementById('refresh-interval');
                if (select) select.value = String(refreshInterval);
            }
            if (config.refresh.autoRefresh === false) {
                isAutoRefresh = false;
                const toggle = document.getElementById('auto-refresh');
                if (toggle) toggle.checked = false;
            }
        }

        console.log(`[HW Monitor] Configuración cargada: ${MACHINES.length} equipos`);
    } catch (err) {
        console.error('[HW Monitor] Error cargando config.json:', err);
        showToast('⚠️ Error cargando configuración. Revisa config.json', 'error');
    }
}

function initControls() {
    const autoRefreshToggle = document.getElementById('auto-refresh');
    const intervalSelect = document.getElementById('refresh-interval');
    const btnRefresh = document.getElementById('btn-refresh');

    autoRefreshToggle.addEventListener('change', () => {
        isAutoRefresh = autoRefreshToggle.checked;
        if (isAutoRefresh) startAutoRefresh();
        else stopAutoRefresh();
    });

    intervalSelect.addEventListener('change', () => {
        refreshInterval = parseInt(intervalSelect.value);
        if (isAutoRefresh) {
            stopAutoRefresh();
            startAutoRefresh();
        }
    });

    btnRefresh.addEventListener('click', () => {
        btnRefresh.classList.add('spinning');
        fetchAllData().then(() => {
            setTimeout(() => btnRefresh.classList.remove('spinning'), 300);
        });
    });
}

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(fetchAllData, refreshInterval);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// ============================================================
// DATA FETCHING
// ============================================================
async function fetchMachineData(machine) {
    // Use the proxy server to avoid CORS issues
    const url = `/api/data?host=${machine.ip}&port=${machine.port}`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        // Check if proxy returned an error object
        if (data.error) throw new Error(data.error);
        return { machine, data, online: true, error: null };
    } catch (err) {
        return { machine, data: null, online: false, error: err.message };
    }
}

async function fetchAllData() {
    const results = await Promise.allSettled(
        MACHINES.map(m => fetchMachineData(m))
    );

    let onlineCount = 0;
    results.forEach(result => {
        const { machine, data, online, error } = result.value || result.reason || {};
        if (!machine) return;

        machineData[machine.id] = { machine, data, online, error };
        if (online) onlineCount++;
    });

    updateGlobalStatus(onlineCount, MACHINES.length);
    updateOverviewCards();
    updateDetailPanels();
    updateLastRefresh();
    checkTemperatureAlerts();
}

// ============================================================
// DATA PARSING HELPERS
// ============================================================
function parseValue(rawStr) {
    if (!rawStr) return null;
    // Handle locale format: "81,0 °C" → 81.0
    const cleaned = rawStr.replace(/[^0-9,.\-]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
}

function findChildrenByText(node, text) {
    if (!node || !node.Children) return [];
    return node.Children.filter(c => c.Text === text);
}

function findChildByText(node, text) {
    const results = findChildrenByText(node, text);
    return results.length > 0 ? results[0] : null;
}

function findByTextRecursive(node, text) {
    if (!node) return null;
    if (node.Text === text) return node;
    if (node.Children) {
        for (const child of node.Children) {
            const found = findByTextRecursive(child, text);
            if (found) return found;
        }
    }
    return null;
}

function findAllByType(node, type) {
    const results = [];
    if (!node) return results;
    if (node.Type === type) results.push(node);
    if (node.Children) {
        for (const child of node.Children) {
            results.push(...findAllByType(child, type));
        }
    }
    return results;
}

function findHardwareNode(data, pathPrefix) {
    if (!data || !data.Children) return null;
    const computerNode = data.Children[0];
    if (!computerNode || !computerNode.Children) return null;

    for (const hw of computerNode.Children) {
        if (hw.HardwareId && hw.HardwareId.startsWith(pathPrefix)) return hw;
    }
    return null;
}

function findAllHardwareNodes(data, pathPrefix) {
    const results = [];
    if (!data || !data.Children) return results;
    const computerNode = data.Children[0];
    if (!computerNode || !computerNode.Children) return results;

    for (const hw of computerNode.Children) {
        if (hw.HardwareId && hw.HardwareId.startsWith(pathPrefix)) results.push(hw);
    }
    return results;
}

function getComputerName(data) {
    if (!data || !data.Children || !data.Children[0]) return 'Unknown';
    return data.Children[0].Text || 'Unknown';
}

function getCpuName(data) {
    const cpu = findHardwareNode(data, '/intelcpu') || findHardwareNode(data, '/amdcpu');
    return cpu ? cpu.Text : 'N/A';
}

function getGpuName(data) {
    const gpu = findHardwareNode(data, '/gpu-nvidia') || findHardwareNode(data, '/gpu-amd') || findHardwareNode(data, '/gpu-intel');
    return gpu ? gpu.Text : 'N/A';
}

function getCpuTemp(data) {
    const cpu = findHardwareNode(data, '/intelcpu') || findHardwareNode(data, '/amdcpu');
    if (!cpu) return { value: null, min: null, max: null };

    const temps = findChildByText(cpu, 'Temperatures');
    if (!temps) return { value: null, min: null, max: null };

    // Look for "CPU Package" or "Core Average" or "Core Max"
    let sensor = findChildByText(temps, 'CPU Package') || findChildByText(temps, 'Core Max') || findChildByText(temps, 'Core Average');
    if (!sensor && temps.Children && temps.Children.length > 0) sensor = temps.Children[0];

    return {
        value: parseValue(sensor?.Value),
        min: parseValue(sensor?.Min),
        max: parseValue(sensor?.Max),
    };
}

function getCpuLoad(data) {
    const cpu = findHardwareNode(data, '/intelcpu') || findHardwareNode(data, '/amdcpu');
    if (!cpu) return null;

    const load = findChildByText(cpu, 'Load');
    if (!load) return null;

    const total = findChildByText(load, 'CPU Total');
    return parseValue(total?.Value);
}

function getCpuPower(data) {
    const cpu = findHardwareNode(data, '/intelcpu') || findHardwareNode(data, '/amdcpu');
    if (!cpu) return null;

    const powers = findChildByText(cpu, 'Powers');
    if (!powers) return null;

    const pkg = findChildByText(powers, 'CPU Package');
    return parseValue(pkg?.Value);
}

function getGpuTemp(data) {
    const gpus = findAllHardwareNodes(data, '/gpu-nvidia')
        .concat(findAllHardwareNodes(data, '/gpu-amd'))
        .concat(findAllHardwareNodes(data, '/gpu-intel'));

    const results = [];
    for (const gpu of gpus) {
        const temps = findChildByText(gpu, 'Temperatures');
        if (!temps) continue;
        const core = findChildByText(temps, 'GPU Core');
        const hotspot = findChildByText(temps, 'GPU Hot Spot');
        results.push({
            name: gpu.Text,
            coreTemp: parseValue(core?.Value),
            coreTempMax: parseValue(core?.Max),
            hotspotTemp: parseValue(hotspot?.Value),
            hotspotTempMax: parseValue(hotspot?.Max),
        });
    }
    return results;
}

function getGpuLoad(data) {
    const gpus = findAllHardwareNodes(data, '/gpu-nvidia')
        .concat(findAllHardwareNodes(data, '/gpu-amd'))
        .concat(findAllHardwareNodes(data, '/gpu-intel'));

    const results = [];
    for (const gpu of gpus) {
        const load = findChildByText(gpu, 'Load');
        if (!load) continue;
        const core = findChildByText(load, 'GPU Core');
        results.push({
            name: gpu.Text,
            coreLoad: parseValue(core?.Value),
        });
    }
    return results;
}

function getGpuPower(data) {
    const gpus = findAllHardwareNodes(data, '/gpu-nvidia')
        .concat(findAllHardwareNodes(data, '/gpu-amd'))
        .concat(findAllHardwareNodes(data, '/gpu-intel'));

    const results = [];
    for (const gpu of gpus) {
        const powers = findChildByText(gpu, 'Powers');
        if (!powers) continue;
        const pkg = findChildByText(powers, 'GPU Package');
        results.push({
            name: gpu.Text,
            power: parseValue(pkg?.Value),
        });
    }
    return results;
}

function getRamUsage(data) {
    const ram = findHardwareNode(data, '/ram');
    if (!ram) return { percent: null, used: null, total: null };

    const load = findChildByText(ram, 'Load');
    const dataNode = findChildByText(ram, 'Data');

    const memSensor = load ? findChildByText(load, 'Memory') : null;
    const usedSensor = dataNode ? findChildByText(dataNode, 'Memory Used') : null;
    const totalSensor = dataNode ? (findChildByText(dataNode, 'Memory Available') || null) : null;

    const usedVal = parseValue(usedSensor?.Value);
    const availVal = parseValue(totalSensor?.Value);

    return {
        percent: parseValue(memSensor?.Value),
        used: usedVal,
        total: usedVal && availVal ? +(usedVal + availVal).toFixed(1) : null,
    };
}

function getGpuFans(data) {
    const gpus = findAllHardwareNodes(data, '/gpu-nvidia')
        .concat(findAllHardwareNodes(data, '/gpu-amd'));

    const results = [];
    for (const gpu of gpus) {
        const fans = findChildByText(gpu, 'Fans');
        if (!fans || !fans.Children) continue;
        for (const fan of fans.Children) {
            results.push({
                gpuName: gpu.Text,
                fanName: fan.Text,
                rpm: parseValue(fan.Value),
            });
        }
    }
    return results;
}

// ============================================================
// UI BUILDING
// ============================================================
function buildOverviewCards() {
    const container = document.getElementById('overview-row');
    container.innerHTML = '';

    MACHINES.forEach(machine => {
        const card = document.createElement('div');
        card.className = 'machine-card';
        card.id = `card-${machine.id}`;
        card.style.setProperty('--card-accent', machine.color);

        card.innerHTML = `
            <div class="card-header">
                <div class="card-header-left">
                    <div class="machine-icon" style="color: ${machine.color}; border: 1px solid ${machine.color}33">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                    </div>
                    <div>
                        <div class="machine-name" id="name-${machine.id}">${machine.name}</div>
                        <div class="machine-ip">${machine.ip}:${machine.port}</div>
                    </div>
                </div>
                <div class="connection-badge offline" id="badge-${machine.id}">
                    <span class="dot"></span>
                    <span>Offline</span>
                </div>
            </div>
            <div class="metrics-grid" id="metrics-${machine.id}">
                <div class="metric-cell"><div class="skeleton" style="height: 40px"></div></div>
                <div class="metric-cell"><div class="skeleton" style="height: 40px"></div></div>
                <div class="metric-cell"><div class="skeleton" style="height: 40px"></div></div>
            </div>
            <div class="temp-bar-container" id="tempbar-${machine.id}">
                <div class="temp-bar-label">
                    <span>Temperatura CPU</span>
                    <span id="tempval-${machine.id}">—</span>
                </div>
                <div class="temp-bar">
                    <div class="temp-bar-fill ok" id="tempfill-${machine.id}" style="width: 0%"></div>
                </div>
            </div>
        `;

        card.addEventListener('click', () => togglePanel(machine.id));
        container.appendChild(card);
    });
}

function buildDetailPanels() {
    const container = document.getElementById('detail-panels');
    container.innerHTML = '';

    MACHINES.forEach(machine => {
        const panel = document.createElement('div');
        panel.className = 'detail-panel';
        panel.id = `panel-${machine.id}`;

        panel.innerHTML = `
            <div class="panel-header" onclick="togglePanel('${machine.id}')">
                <div class="panel-header-left">
                    <div class="panel-machine-dot" style="background: ${machine.color}"></div>
                    <span class="panel-title" id="panel-title-${machine.id}">${machine.name}</span>
                    <span class="panel-subtitle" id="panel-sub-${machine.id}">—</span>
                </div>
                <svg class="panel-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="panel-body">
                <div class="panel-content" id="panel-content-${machine.id}">
                    <p style="color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;">Esperando datos...</p>
                </div>
            </div>
        `;

        container.appendChild(panel);
    });
}

// ============================================================
// UI UPDATES
// ============================================================
function updateGlobalStatus(online, total) {
    const statusEl = document.getElementById('global-status');
    const pulse = statusEl.querySelector('.pulse');
    const text = statusEl.querySelector('.status-text');

    pulse.className = 'pulse';
    if (online === total) {
        pulse.classList.add('online');
        text.textContent = `${online}/${total} equipos online`;
    } else if (online === 0) {
        pulse.classList.add('offline');
        text.textContent = 'Todos offline';
    } else {
        pulse.classList.add('partial');
        text.textContent = `${online}/${total} equipos online`;
    }
}

function updateLastRefresh() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('last-update').textContent = timeStr;
}

function updateOverviewCards() {
    MACHINES.forEach(machine => {
        const info = machineData[machine.id];
        if (!info) return;

        const badge = document.getElementById(`badge-${machine.id}`);
        const card = document.getElementById(`card-${machine.id}`);
        const nameEl = document.getElementById(`name-${machine.id}`);

        if (info.online) {
            badge.className = 'connection-badge online';
            badge.innerHTML = '<span class="dot"></span><span>Online</span>';
            card.classList.remove('offline');

            // Update machine name from data
            const compName = getComputerName(info.data);
            nameEl.textContent = compName || machine.name;

            updateMetrics(machine, info.data);
            updateTempBar(machine, info.data);
        } else {
            badge.className = 'connection-badge offline';
            badge.innerHTML = '<span class="dot"></span><span>Offline</span>';
            card.classList.add('offline');

            const metricsEl = document.getElementById(`metrics-${machine.id}`);
            metricsEl.innerHTML = `
                <div class="metric-cell" style="grid-column: span 3; text-align: center;">
                    <div class="metric-label">Estado</div>
                    <div class="metric-value" style="color: var(--color-danger); font-size: 0.9rem;">Sin conexión</div>
                </div>
            `;
        }
    });
}

function updateMetrics(machine, data) {
    const metricsEl = document.getElementById(`metrics-${machine.id}`);

    const cpuTemp = getCpuTemp(data);
    const cpuLoad = getCpuLoad(data);
    const cpuPower = getCpuPower(data);
    const gpuTemps = getGpuTemp(data);
    const gpuLoads = getGpuLoad(data);
    const ram = getRamUsage(data);

    // Determine max GPU temp
    let maxGpuTemp = null;
    let maxGpuTempMax = null;
    gpuTemps.forEach(g => {
        if (g.coreTemp !== null && (maxGpuTemp === null || g.coreTemp > maxGpuTemp)) {
            maxGpuTemp = g.coreTemp;
        }
        if (g.coreTempMax !== null && (maxGpuTempMax === null || g.coreTempMax > maxGpuTempMax)) {
            maxGpuTempMax = g.coreTempMax;
        }
    });

    // Max GPU load
    let maxGpuLoad = null;
    gpuLoads.forEach(g => {
        if (g.coreLoad !== null && (maxGpuLoad === null || g.coreLoad > maxGpuLoad)) {
            maxGpuLoad = g.coreLoad;
        }
    });

    const tempClass = getTempClass(cpuTemp.value, TEMP_THRESHOLDS);
    const gpuTempClass = getTempClass(maxGpuTemp, GPU_TEMP_THRESHOLDS);

    let cells = '';

    // CPU Temp
    cells += `
        <div class="metric-cell">
            <div class="metric-label">🌡 CPU Temp</div>
            <div class="metric-value temp ${tempClass}">${cpuTemp.value !== null ? cpuTemp.value.toFixed(0) : '—'}<span class="metric-unit">°C</span></div>
            ${cpuTemp.max !== null ? `<div class="metric-range">máx ${cpuTemp.max.toFixed(0)}°C</div>` : ''}
        </div>
    `;

    // CPU Load
    cells += `
        <div class="metric-cell">
            <div class="metric-label">⚡ CPU Load</div>
            <div class="metric-value load">${cpuLoad !== null ? cpuLoad.toFixed(1) : '—'}<span class="metric-unit">%</span></div>
            ${cpuPower !== null ? `<div class="metric-range">${cpuPower.toFixed(0)} W</div>` : ''}
        </div>
    `;

    // GPU Temp
    cells += `
        <div class="metric-cell">
            <div class="metric-label">🎮 GPU Temp</div>
            <div class="metric-value gpu-temp ${gpuTempClass}">${maxGpuTemp !== null ? maxGpuTemp.toFixed(0) : '—'}<span class="metric-unit">°C</span></div>
            ${maxGpuTempMax !== null ? `<div class="metric-range">máx ${maxGpuTempMax.toFixed(0)}°C</div>` : ''}
        </div>
    `;

    // GPU Load
    cells += `
        <div class="metric-cell">
            <div class="metric-label">📊 GPU Load</div>
            <div class="metric-value load">${maxGpuLoad !== null ? maxGpuLoad.toFixed(1) : '—'}<span class="metric-unit">%</span></div>
        </div>
    `;

    // RAM
    cells += `
        <div class="metric-cell">
            <div class="metric-label">💾 RAM</div>
            <div class="metric-value info">${ram.percent !== null ? ram.percent.toFixed(1) : '—'}<span class="metric-unit">%</span></div>
            ${ram.used !== null && ram.total !== null ? `<div class="metric-range">${ram.used.toFixed(0)}/${ram.total.toFixed(0)} GB</div>` : ''}
        </div>
    `;

    // GPU Fan (show max RPM across GPUs)
    const fans = getGpuFans(data);
    let maxRpm = null;
    fans.forEach(f => {
        if (f.rpm !== null && (maxRpm === null || f.rpm > maxRpm)) maxRpm = f.rpm;
    });

    cells += `
        <div class="metric-cell">
            <div class="metric-label">🌀 GPU Fan</div>
            <div class="metric-value info">${maxRpm !== null ? maxRpm.toFixed(0) : '—'}<span class="metric-unit">RPM</span></div>
        </div>
    `;

    metricsEl.innerHTML = cells;
}

function updateTempBar(machine, data) {
    const cpuTemp = getCpuTemp(data);
    const fill = document.getElementById(`tempfill-${machine.id}`);
    const val = document.getElementById(`tempval-${machine.id}`);

    if (cpuTemp.value !== null) {
        const pct = Math.min(100, (cpuTemp.value / TEMP_THRESHOLDS.max) * 100);
        fill.style.width = pct + '%';
        fill.className = 'temp-bar-fill ' + getTempClass(cpuTemp.value, TEMP_THRESHOLDS);
        val.textContent = cpuTemp.value.toFixed(0) + '°C';
        val.style.color = getTempColor(cpuTemp.value, TEMP_THRESHOLDS);
    }
}

function getTempClass(temp, thresholds) {
    if (temp === null) return '';
    if (temp >= thresholds.danger) return 'danger';
    if (temp >= thresholds.warn) return 'warn';
    return 'ok';
}

function getTempColor(temp, thresholds) {
    if (temp === null) return 'var(--text-muted)';
    if (temp >= thresholds.danger) return 'var(--color-danger)';
    if (temp >= thresholds.warn) return 'var(--color-warn)';
    return 'var(--color-ok)';
}

// ============================================================
// DETAIL PANELS
// ============================================================
function togglePanel(machineId) {
    const panel = document.getElementById(`panel-${machineId}`);
    if (expandedPanels.has(machineId)) {
        expandedPanels.delete(machineId);
        panel.classList.remove('expanded');
    } else {
        expandedPanels.add(machineId);
        panel.classList.add('expanded');
        updateSingleDetailPanel(machineId);
    }
}

function updateDetailPanels() {
    expandedPanels.forEach(id => updateSingleDetailPanel(id));

    // Also update panel headers
    MACHINES.forEach(machine => {
        const info = machineData[machine.id];
        if (!info || !info.online || !info.data) return;

        const titleEl = document.getElementById(`panel-title-${machine.id}`);
        const subEl = document.getElementById(`panel-sub-${machine.id}`);

        const compName = getComputerName(info.data);
        titleEl.textContent = compName || machine.name;

        const cpuName = getCpuName(info.data);
        const gpuName = getGpuName(info.data);
        subEl.textContent = `${cpuName} • ${gpuName}`;
    });
}

function updateSingleDetailPanel(machineId) {
    const info = machineData[machineId];
    const contentEl = document.getElementById(`panel-content-${machineId}`);

    if (!info || !info.online || !info.data) {
        contentEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;">Equipo no disponible</p>';
        return;
    }

    const data = info.data;
    let html = '';

    // CPU Section
    const cpu = findHardwareNode(data, '/intelcpu') || findHardwareNode(data, '/amdcpu');
    if (cpu) {
        html += buildSensorSection('CPU — ' + cpu.Text, '🔧', cpu);
    }

    // GPU Sections
    const gpus = findAllHardwareNodes(data, '/gpu-nvidia')
        .concat(findAllHardwareNodes(data, '/gpu-amd'))
        .concat(findAllHardwareNodes(data, '/gpu-intel'));

    gpus.forEach((gpu, idx) => {
        html += buildSensorSection(`GPU ${idx} — ${gpu.Text}`, '🎮', gpu);
    });

    // RAM
    const ram = findHardwareNode(data, '/ram');
    if (ram) {
        html += buildSensorSection('RAM', '💾', ram);
    }

    // Storage
    const nvmeList = findAllHardwareNodes(data, '/nvme');
    const hddList = findAllHardwareNodes(data, '/hdd');
    [...nvmeList, ...hddList].forEach(disk => {
        if (disk.Text.includes('\u0000')) {
            html += buildSensorSection('Almacenamiento', '💿', disk);
        } else {
            html += buildSensorSection(`Disco — ${disk.Text}`, '💿', disk);
        }
    });

    // Network
    const nics = findAllHardwareNodes(data, '/nic');
    nics.forEach(nic => {
        html += buildSensorSection(`Red — ${nic.Text}`, '🌐', nic);
    });

    contentEl.innerHTML = html;
}

function buildSensorSection(title, icon, hardwareNode) {
    if (!hardwareNode || !hardwareNode.Children) return '';

    let html = `<div class="sensor-section">`;
    html += `<div class="sensor-section-title">${icon} ${title}</div>`;

    // iterate categories (Temperatures, Load, Powers, Clocks, etc.)
    for (const category of hardwareNode.Children) {
        if (!category.Children || category.Children.length === 0) continue;

        // Filter out categories with too many items (like per-core loads)
        const sensors = category.Children;
        const isExpansive = sensors.length > 12;
        const displaySensors = isExpansive ? filterImportantSensors(sensors, category.Text) : sensors;

        if (displaySensors.length === 0) continue;

        html += `<div class="sensor-grid">`;

        for (const sensor of displaySensors) {
            if (!sensor.Value && sensor.Value !== '0') continue;

            const valClass = getSensorValueClass(sensor);
            html += `
                <div class="sensor-item">
                    <span class="sensor-name" title="${sensor.Text}">${sensor.Text}</span>
                    <span class="sensor-val ${valClass}">${sensor.Value || '—'}</span>
                </div>
            `;
        }

        if (isExpansive && displaySensors.length < sensors.length) {
            html += `
                <div class="sensor-item" style="justify-content: center; color: var(--text-muted); font-size: 0.7rem;">
                    +${sensors.length - displaySensors.length} sensores más
                </div>
            `;
        }

        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

function filterImportantSensors(sensors, categoryName) {
    // For large sensor lists, show only summary sensors
    const important = ['Total', 'Package', 'Average', 'Max', 'Core Max', 'Core Average', 'CPU Total', 'CPU Core Max', 'Memory'];

    const filtered = sensors.filter(s => {
        return important.some(keyword => s.Text.includes(keyword)) ||
            s.Text === 'Bus Speed';
    });

    // If filter removes everything, show first 6
    if (filtered.length === 0) return sensors.slice(0, 6);
    return filtered;
}

function getSensorValueClass(sensor) {
    if (!sensor.Type) return 'info';

    if (sensor.Type === 'Temperature') {
        const val = parseValue(sensor.Value);
        if (val === null) return '';
        if (sensor.SensorId?.includes('/gpu')) {
            return 'temp-' + getTempClass(val, GPU_TEMP_THRESHOLDS);
        }
        return 'temp-' + getTempClass(val, TEMP_THRESHOLDS);
    }

    return 'info';
}

// ============================================================
// TEMPERATURE ALERTS
// ============================================================
function checkTemperatureAlerts() {
    MACHINES.forEach(machine => {
        const info = machineData[machine.id];
        if (!info || !info.online || !info.data) return;

        const cpuTemp = getCpuTemp(info.data);
        const key = machine.id + '-cpu';
        const prev = previousTemps[key];

        if (cpuTemp.value !== null && cpuTemp.value >= TEMP_THRESHOLDS.danger) {
            if (!prev || prev < TEMP_THRESHOLDS.danger) {
                showToast(`⚠️ ${machine.name}: CPU a ${cpuTemp.value.toFixed(0)}°C — ¡Temperatura crítica!`, 'error');
            }
        } else if (cpuTemp.value !== null && cpuTemp.value >= TEMP_THRESHOLDS.warn) {
            if (!prev || prev < TEMP_THRESHOLDS.warn) {
                showToast(`🌡 ${machine.name}: CPU a ${cpuTemp.value.toFixed(0)}°C — Temperatura elevada`, 'warning');
            }
        }

        previousTemps[key] = cpuTemp.value;

        // GPU alerts
        const gpuTemps = getGpuTemp(info.data);
        gpuTemps.forEach((g, idx) => {
            const gpuKey = machine.id + `-gpu-${idx}`;
            const gpuPrev = previousTemps[gpuKey];

            if (g.coreTemp !== null && g.coreTemp >= GPU_TEMP_THRESHOLDS.danger) {
                if (!gpuPrev || gpuPrev < GPU_TEMP_THRESHOLDS.danger) {
                    showToast(`⚠️ ${machine.name}: GPU a ${g.coreTemp.toFixed(0)}°C — ¡Temperatura crítica!`, 'error');
                }
            }

            previousTemps[gpuKey] = g.coreTemp;
        });
    });
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Make togglePanel available globally for onclick
window.togglePanel = togglePanel;
