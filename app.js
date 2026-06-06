// app.js - Motor de Reconciliação e UI Controller (Offline-First)

// 1. Configuração do IndexedDB Local
const DB_NAME = 'GoianitaConsignacaoDB';
const DB_VERSION = 1;
const STORE_NAME = 'consignacao_master';

let db;
let consignacaoActiveStock = []; // Armazenamento temporário em memória para reconciliação ativa
let matchedResults = [];
let divergentResults = [];
let reconciliationChart = null;

// Inicialização da IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'sku' });
            }
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            loadStoredMaster().then(resolve);
        };
        
        request.onerror = (e) => {
            console.error('Erro ao abrir IndexedDB:', e.target.error);
            reject(e.target.error);
        };
    });
}

// Carregar estoque salvo localmente
function loadStoredMaster() {
    return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const data = request.result;
            if (data && data.length > 0) {
                consignacaoActiveStock = data;
                updateDBStatusUI(true, data);
                enableSalesDropzone(true);
            } else {
                updateDBStatusUI(false);
                enableSalesDropzone(false);
            }
            resolve();
        };
    });
}

// Salvar a Planilha Mestra (Aba T4) no IndexedDB
function saveMasterToDB(products) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Limpar dados anteriores
        store.clear();
        
        products.forEach(p => {
            store.put(p);
        });
        
        transaction.oncomplete = () => {
            consignacaoActiveStock = products;
            updateDBStatusUI(true, products);
            enableSalesDropzone(true);
            resolve();
        };
        
        transaction.onerror = (e) => {
            console.error('Erro ao salvar no IndexedDB:', e.target.error);
            reject(e.target.error);
        };
    });
}

// Deletar base local
function clearDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        
        transaction.oncomplete = () => {
            consignacaoActiveStock = [];
            updateDBStatusUI(false);
            enableSalesDropzone(false);
            hideResults();
            resolve();
        };
        
        transaction.onerror = (e) => {
            reject(e.target.error);
        };
    });
}

// 2. Controladores da Interface (UI)
const masterDropzone = document.getElementById('master-dropzone');
const masterFileInput = document.getElementById('master-file-input');
const salesDropzone = document.getElementById('sales-dropzone');
const salesFileInput = document.getElementById('sales-file-input');
const dbStatusCard = document.getElementById('db-status-card');
const dbStatusIcon = document.getElementById('db-status-icon');
const dbStatusTitle = document.getElementById('db-status-title');
const dbStatusText = document.getElementById('db-status-text');
const dbDetails = document.getElementById('db-details');
const btnResetDb = document.getElementById('btn-reset-db');

const valSkus = document.getElementById('val-skus');
const valQty = document.getElementById('val-qty');
const valValue = document.getElementById('val-value');

const pricingPDV = document.getElementById('pricing-pdv');
const pricingCusto = document.getElementById('pricing-custo');
const pricingFator = document.getElementById('pricing-fator');
const sliderContainer = document.getElementById('slider-container');
const slider = document.getElementById('price-factor-slider');
const sliderVal = document.getElementById('slider-val');

const resultsSection = document.getElementById('results-section');
const statQtyMatched = document.getElementById('stat-qty-matched');
const statValueMatched = document.getElementById('stat-value-matched');
const statQtyDivergent = document.getElementById('stat-qty-divergent');
const divergencesPanel = document.getElementById('divergences-panel');
const divergencesTableBody = document.getElementById('divergences-table-body');
const btnExportOlist = document.getElementById('btn-export-olist');

// Elementos Google Sheets
const sheetsUrlInput = document.getElementById('sheets-url');
const sheetsAutoSyncCheckbox = document.getElementById('sheets-auto-sync');
const btnTestSheets = document.getElementById('btn-test-sheets');
const sheetsTestStatus = document.getElementById('sheets-test-status');
const btnSyncSheets = document.getElementById('btn-sync-sheets');

// Atualizar status visual do IndexedDB
function updateDBStatusUI(active, data = []) {
    if (active) {
        dbStatusCard.classList.add('active');
        dbStatusIcon.textContent = '';
        dbStatusIcon.style.display = 'none';
        dbStatusTitle.textContent = 'Base Contábil Ativa';
        
        // Calcular totais
        const totalSKUs = data.length;
        const totalQty = data.reduce((acc, curr) => acc + (curr.qty || 0), 0);
        const totalValue = data.reduce((acc, curr) => acc + ((curr.qty || 0) * (curr.cost || 0)), 0);
        
        dbStatusText.textContent = 'Planilha Virtual carregada localmente';
        valSkus.textContent = totalSKUs.toLocaleString('pt-BR');
        valQty.textContent = totalQty.toLocaleString('pt-BR');
        valValue.textContent = formatCurrency(totalValue);
        
        dbDetails.style.display = 'flex';
        btnResetDb.style.display = 'block';
    } else {
        dbStatusCard.classList.remove('active');
        dbStatusIcon.textContent = '';
        dbStatusIcon.style.display = 'none';
        dbStatusTitle.textContent = 'Aguardando Base Contábil';
        dbStatusText.textContent = 'IndexedDB local vazia';
        
        dbDetails.style.display = 'none';
        btnResetDb.style.display = 'none';
    }
}

// Habilitar/Desabilitar drag & drop de vendas
function enableSalesDropzone(enable) {
    const salesDropText = document.getElementById('sales-drop-text');
    if (enable) {
        salesDropzone.classList.remove('disabled');
        salesFileInput.disabled = false;
        salesDropText.innerHTML = 'Arraste o arquivo de vendas da <strong>Castor</strong> ou clique para navegar';
    } else {
        salesDropzone.classList.add('disabled');
        salesFileInput.disabled = true;
        salesDropText.innerHTML = 'Carregue primeiro a planilha mestra (Virtual)';
    }
}

// Formatação de Dinheiro (BRL)
function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Esconder Painel de Resultados
function hideResults() {
    resultsSection.style.display = 'none';
    divergencesPanel.style.display = 'none';
}

// Ouvir mudanças nos Radio Buttons de Precificação
document.querySelectorAll('input[name="pricing-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        if (pricingFator.checked) {
            sliderContainer.style.display = 'flex';
        } else {
            sliderContainer.style.display = 'none';
        }
    });
});

// Atualizar valor exibido do slider
slider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    sliderVal.textContent = (val >= 0 ? '+' : '') + val + '%';
});

// Resetar base local ao clicar
btnResetDb.addEventListener('click', () => {
    if (confirm('Tem certeza de que deseja apagar a base de consignação salva neste navegador?')) {
        clearDB();
    }
});

// 3. Gerenciamento de Arquivos e Parsing (Fase 1 e 2 do Backlog)
// Configurar eventos do dropzone da Planilha Mestra (Virtual T4)
masterDropzone.addEventListener('click', () => masterFileInput.click());
masterDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    masterDropzone.classList.add('dragover');
});
masterDropzone.addEventListener('dragleave', () => masterDropzone.classList.remove('dragover'));
masterDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    masterDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleMasterFile(e.dataTransfer.files[0]);
    }
});
masterFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleMasterFile(e.target.files[0]);
    }
});

// Processar a Planilha Mestra (T4) — suporte a CSV e XLSX
function handleMasterFile(file) {
    const reader = new FileReader();
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    reader.onload = (e) => {
        try {
            let jsonData = [];

            if (isCSV) {
                // Parsear CSV diretamente (sem depender de abas)
                jsonData = parseCSV(e.target.result);
            } else {
                // XLSX: tenta encontrar aba com Virtual no nome, senão usa a primeira
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const targetSheetName = workbook.SheetNames.find(name => name.toUpperCase().includes('VIRTUAL') || name.toUpperCase().includes('T4'))
                    || workbook.SheetNames[0];
                const worksheet = workbook.Sheets[targetSheetName];
                jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
            }

            if (!jsonData || jsonData.length < 2) {
                alert('Erro: Arquivo vazio ou com formato incorreto.');
                return;
            }

            // ── Detecção automática de colunas pelo cabeçalho ──────────────────
            // Estrutura do CSV Goianita:
            //   A: Produto | B: Código (SKU) | C: Preço Custo | D: Preço Venda | E: ... | G: Total
            //
            // REGRA DE NEGÓCIO:
            //   - Coluna G (Total) = quantidade total no contrato de consignação Castor
            //   - Se Total > 0, o SKU pertence à consignação e deve ser reconciliado
            //   - Colunas D, E, F são estoques parciais (ignorados para reconciliação)
            let colSku = null, colName = null, colQty = null;
            let colCost = null, colPrice = null;

            // Encontra a linha de cabeçalho
            const headerRow = jsonData.find(row =>
                Object.values(row).some(v => {
                    const t = v ? v.toString().toUpperCase() : '';
                    return t.includes('SKU') || t.includes('CÓDIGO') || t.includes('CODIGO') || t.includes('PRODUTO');
                })
            );

            if (headerRow) {
                for (const [key, value] of Object.entries(headerRow)) {
                    if (!value) continue;
                    const text = value.toString().toUpperCase().trim();

                    // SKU — "Código (SKU)", "Código", "SKU"
                    if (text.includes('SKU') || text.includes('CÓDIGO') || text.includes('CODIGO')) {
                        colSku = colSku || key;
                    }
                    // Nome — "Produto", "Nome"
                    else if (text.includes('PRODUTO') || text.includes('NOME')) {
                        colName = colName || key;
                    }
                    // Quantidade da consignação = coluna "Total" (G)
                    else if (text === 'TOTAL' || text.includes('TOTAL COMODATO') || text.includes('TOTAL CONSIGNAÇÃO')) {
                        colQty = colQty || key;
                    }
                    // Fallback genérico de quantidade (apenas se "Total" não foi encontrado)
                    else if ((text.includes('QUANTIDADE') || text.includes('QTD')) && !colQty) {
                        colQty = key;
                    }
                    // Preço de Custo
                    else if (text.includes('CUSTO')) {
                        colCost = colCost || key;
                    }
                    // Preço de Venda
                    else if (text.includes('VENDA') || text.includes('PDV')) {
                        colPrice = colPrice || key;
                    }
                }
            }

            // Fallback por posição (estrutura padrão do CSV Goianita)
            if (!colSku)  colSku  = 'B'; // Código (SKU) = coluna B
            if (!colName) colName = 'A'; // Produto       = coluna A
            if (!colQty)  colQty  = 'G'; // Total         = coluna G ← consignação Castor

            console.log('📋 Colunas detectadas para Planilha Mestra:', { colSku, colName, colQty, colCost, colPrice });

            // ── Processar linhas de dados ────────────────────────────────────────
            const products = [];
            jsonData.forEach((row, idx) => {
                const skuRaw = row[colSku] ? row[colSku].toString().trim() : '';
                const nameRaw = row[colName] ? row[colName].toString().trim() : '';

                // Ignorar linhas vazias e cabeçalhos
                if (!skuRaw) return;
                const upper = skuRaw.toUpperCase();
                if (upper.includes('SKU') || upper.includes('CÓDIGO') || upper.includes('CODIGO') ||
                    upper.includes('PRODUTO') || upper.includes('ESTOQUE')) return;

                // Limpar valor numérico (suporta moeda com R$ e vírgula decimal)
                const parseNum = (v) => {
                    if (!v) return 0;
                    // Remove R$, espaços e qualquer caractere que não seja número, vírgula ou ponto
                    let cleanStr = v.toString().replace(/[^\d,\.-]/g, '');
                    // Trata os pontos de milhar e a vírgula decimal
                    cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
                    return parseFloat(cleanStr) || 0;
                };

                // colQty = coluna G (Total) = quantidade total na consignação Castor
                const qtyVal = Math.floor(parseNum(row[colQty]));

                // Se Total = 0, o SKU não faz parte do contrato de consignação → ignorar
                if (qtyVal <= 0) return;

                products.push({
                    sku:  normalizeSku(skuRaw), // ← normalizado = chave consistente com o stockMap
                    name: nameRaw || 'PRODUTO SEM NOME',
                    cost: colCost ? parseNum(row[colCost]) : 0,
                    price: colPrice ? parseNum(row[colPrice]) : 0,
                    qty:  qtyVal
                });
            });

            if (products.length === 0) {
                alert('Nenhuma quantidade de consignação encontrada!\n\nVerifique se a coluna G (Total) da planilha possui valores maiores que zero.\nApenas itens com Total > 0 são considerados parte do contrato Castor.');
                return;
            }

            saveMasterToDB(products).then(() => {
                alert(`Sucesso! Base de consignação carregada com ${products.length} SKUs ativos na Virtual.`);
            });

        } catch (err) {
            console.error(err);
            alert('Falha ao ler a planilha mestra: ' + err.message);
        }
    };

    // CSV lê como texto; XLSX lê como binário
    if (isCSV) {
        reader.readAsText(file, 'utf-8');
    } else {
        reader.readAsArrayBuffer(file);
    }
}

// Configurar eventos do dropzone do Relatório de Vendas (Castor 85)
salesDropzone.addEventListener('click', () => {
    if (!salesDropzone.classList.contains('disabled')) {
        salesFileInput.click();
    }
});
salesDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!salesDropzone.classList.contains('disabled')) {
        salesDropzone.classList.add('dragover');
    }
});
salesDropzone.addEventListener('dragleave', () => salesDropzone.classList.remove('dragover'));
salesDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    salesDropzone.classList.remove('dragover');
    if (!salesDropzone.classList.contains('disabled') && e.dataTransfer.files.length > 0) {
        handleSalesFile(e.dataTransfer.files[0]);
    }
});
salesFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleSalesFile(e.target.files[0]);
    }
});

// 4. Engine de Reconciliação Chave (Fase 2 do Backlog)
function handleSalesFile(file) {
    const reader = new FileReader();
    
    // Suporte para CSV e XLSX de forma transparente
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    
    reader.onload = (e) => {
        try {
            let salesRows = [];
            if (isExcel) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                salesRows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
            } else {
                const text = e.target.result;
                salesRows = parseCSV(text);
            }
            
            reconcileSales(salesRows);
        } catch (err) {
            console.error(err);
            alert('Falha ao processar arquivo de vendas: ' + err.message);
        }
    };
    
    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file, 'utf-8'); // Lendo em UTF-8
    }
}

// Parser simples para CSV que lida com aspas
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const rows = [];
    lines.forEach((line, rIdx) => {
        if (!line.trim()) return;
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if ((char === ',' || char === ';') && !inQuotes) { // Suporta separador por vírgula ou ponto-e-vírgula
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        
        // Mapeia para um objeto com colunas A, B, C... para compatibilidade com sheet_to_json
        const mappedRow = {};
        result.forEach((val, idx) => {
            const colLetter = String.fromCharCode(65 + idx); // 0 -> A, 1 -> B...
            mappedRow[colLetter] = val;
        });
        rows.push(mappedRow);
    });
    return rows;
}

// ── Normalização de SKU ─────────────────────────────────────────────────────
// Garante que "10111953", "10111953.0", " 10111953 " e "10111953" sejam iguais
function normalizeSku(raw) {
    if (!raw) return '';
    let s = raw.toString().trim();
    // Remove sufixo decimal desnecessário: "12345.0" → "12345"
    s = s.replace(/\.0+$/, '');
    // Remove espaços internos e converte para maiúsculas
    return s.toUpperCase();
}

// Algoritmo Principal de Matching e Reconciliação
function reconcileSales(salesRows) {
    if (consignacaoActiveStock.length === 0) {
        alert('A base de consignação não está ativa!');
        return;
    }
    
    // Resetar resultados anteriores
    matchedResults = [];
    divergentResults = [];
    
    // Clonar o estoque ativo para manipulação em memória durante a conciliação
    // Chave do mapa = SKU normalizado para evitar falhas por formato diferente
    const stockMap = {};
    consignacaoActiveStock.forEach(p => {
        stockMap[normalizeSku(p.sku)] = { ...p };
    });

    console.log(`📦 StockMap carregado com ${Object.keys(stockMap).length} SKUs.`);
    console.log('Primeiros 5 SKUs na consignação:', Object.keys(stockMap).slice(0, 5));
    
    // Detectar colunas do relatório de vendas da Castor
    let colSku = 'A', colQty = 'D', colPrice = 'C'; 
    
    const headerRow = salesRows.find(row => 
        Object.values(row).some(v => v.toString().toUpperCase().includes('SKU') || v.toString().toUpperCase().includes('CÓDIGO'))
    );
    
    if (headerRow) {
        for (const [key, value] of Object.entries(headerRow)) {
            const text = value.toString().toUpperCase();
            if (text.includes('SKU') || text.includes('CODIGO') || text.includes('CÓDIGO')) colSku = key;
            else if (text.includes('QTD') || text.includes('QUANTIDADE')) colQty = key;
            else if (text.includes('PRECO') || text.includes('VALOR') || text.includes('UNIT') || text.includes('VENDA')) colPrice = key;
        }
    }
    
    let totalMatchedQty = 0;
    let totalMatchedValue = 0;

    // Log diagnóstico: mostra as primeiras linhas do arquivo de vendas
    const sampleSalesSkus = salesRows
        .map(r => r[colSku] ? normalizeSku(r[colSku]) : '')
        .filter(s => s && !s.includes('SKU') && !s.includes('CÓDIGO'))
        .slice(0, 5);
    console.log('🛒 Primeiros 5 SKUs no arquivo de vendas:', sampleSalesSkus);
    console.log('🗂️ Colunas detectadas no arquivo de vendas:', { colSku, colQty, colPrice });
    
    salesRows.forEach(row => {
        const skuRaw  = row[colSku] ? row[colSku].toString().trim() : '';
        const skuStr  = normalizeSku(skuRaw); // ← normalizado para comparação
        const skuOrig = skuRaw;               // ← original para exibição

        if (!skuStr || skuStr.includes('SKU') || skuStr.includes('CÓDIGO') || skuStr.includes('ESTOQUE')) {
            return; // ignora cabeçalho
        }
        
        const qtySold  = parseInt(row[colQty])   || 0;
        const pdvPrice = parseFloat(row[colPrice]) || 0;
        
        if (qtySold <= 0) return;
        
        const match = stockMap[skuStr];
        
        if (!match) {
            // Divergência: SKU vendido na Castor mas que não pertence à consignação
            console.warn(`SKU não encontrado na consignação: "${skuOrig}" (normalizado: "${skuStr}")`);
            // Tenta achar o nome do produto em outras colunas da linha de vendas
            const prodName = (colSku !== 'B' && row['B']) ? row['B']
                           : (colSku !== 'A' && row['A']) ? row['A']
                           : 'PRODUTO NÃO CADASTRADO NA CONSIGNAÇÃO';
            divergentResults.push({
                sku: skuOrig,
                name: prodName,
                qtySold: qtySold,
                comodatoQty: 0,
                reason: 'SKU não encontrado no contrato de consignação — verifique se está na planilha mestra com Total > 0'
            });
            return;
        }
        
        // Calcular o faturamento com base no Motor de Precificação Dinâmica
        let finalPrice = match.cost; // Default: Custo Fixo
        
        if (pricingPDV.checked) {
            finalPrice = pdvPrice || match.cost; // Preserva o preço pago na venda
        } else if (pricingFator.checked) {
            const factor = parseInt(slider.value) / 100;
            finalPrice = match.cost * (1 + factor);
        }
        
        // Reconciliar quantidade
        if (match.qty >= qtySold) {
            // Sucesso absoluto de estoque
            match.qty -= qtySold;
            
            matchedResults.push({
                sku: skuStr,
                name: match.name,
                qty: qtySold,
                price: finalPrice,
                originalCost: match.cost
            });
            
            totalMatchedQty += qtySold;
            totalMatchedValue += (qtySold * finalPrice);
        } else {
            // Estoque insuficiente em comodato: Reconciliação Parcial
            const partialQty = match.qty;
            const remainingQty = qtySold - partialQty;
            
            if (partialQty > 0) {
                matchedResults.push({
                    sku: skuStr,
                    name: match.name,
                    qty: partialQty,
                    price: finalPrice,
                    originalCost: match.cost
                });
                
                totalMatchedQty += partialQty;
                totalMatchedValue += (partialQty * finalPrice);
                match.qty = 0; // Zerado
            }
            
            // A quantidade excedente entra como divergência de estoque
            divergentResults.push({
                sku: skuStr,
                name: match.name,
                qtySold: qtySold,
                comodatoQty: partialQty,
                reason: `Estoque esgotado. Faltam ${remainingQty} unidades na consignação.`
            });
        }
    });
    
    // Calcular total de itens divergentes
    let totalDivergentQty = 0;
    divergentResults.forEach(d => {
        if (d.comodatoQty > 0) {
            totalDivergentQty += (d.qtySold - d.comodatoQty);
        } else {
            totalDivergentQty += d.qtySold;
        }
    });
    
    // Atualizar UI com os resultados calculados
    displayResults(totalMatchedQty, totalMatchedValue, divergentResults, totalDivergentQty);
}

// 5. Exibição e Exportação de Resultados (Fase 3 do Backlog)
function displayResults(matchedQty, matchedValue, divergences, divergentQty = 0) {
    resultsSection.style.display = 'block';
    statQtyMatched.textContent = matchedQty.toLocaleString('pt-BR');
    statValueMatched.textContent = formatCurrency(matchedValue);
    
    const divCount = divergences.length;
    statQtyDivergent.textContent = divCount;
    
    if (divCount > 0) {
        divergencesTableBody.innerHTML = '';
        divergences.forEach(d => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${d.sku}</strong></td>
                <td>${d.name}</td>
                <td>${d.qtySold}</td>
                <td>${d.comodatoQty}</td>
                <td class="error-text">! ${d.reason}</td>
            `;
            divergencesTableBody.appendChild(row);
        });
        divergencesPanel.style.display = 'block';
    } else {
        divergencesPanel.style.display = 'none';
    }
    
    // Renderizar gráfico
    renderReconciliationChart(matchedQty, divergentQty);
    
    // Suave Scroll para resultados
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Renderização do gráfico de reconciliação
function renderReconciliationChart(matchedQty, divergentQty) {
    const canvas = document.getElementById('reconciliation-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    if (reconciliationChart) {
        reconciliationChart.destroy();
    }
    
    // Se ambos forem zero (caso de erro ou arquivo vazio)
    if (matchedQty === 0 && divergentQty === 0) {
        return;
    }
    
    reconciliationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Reconciliados', 'Divergências'],
            datasets: [{
                data: [matchedQty, divergentQty],
                backgroundColor: [
                    '#2DB87E', // verde sucesso
                    '#E63A3A'  // vermelho erro
                ],
                borderWidth: 2,
                borderColor: '#1a1a2e',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#b3b3b3',
                        padding: 15,
                        font: {
                            family: "'Inter', sans-serif",
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${value} unidades (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Carregar configurações do Google Sheets do localStorage
function loadSheetsSettings() {
    if (localStorage.getItem('sheets_url')) sheetsUrlInput.value = localStorage.getItem('sheets_url');
    if (localStorage.getItem('sheets_auto_sync') !== null) {
        sheetsAutoSyncCheckbox.checked = localStorage.getItem('sheets_auto_sync') === 'true';
    }
}

// Salvar configurações do Google Sheets no localStorage
function saveSheetsSettings() {
    localStorage.setItem('sheets_url', sheetsUrlInput.value.trim());
    localStorage.setItem('sheets_auto_sync', sheetsAutoSyncCheckbox.checked);
}

// Registrar no Google Sheets via Apps Script Web App
function syncToGoogleSheets(testMode = false) {
    saveSheetsSettings();
    
    const url = sheetsUrlInput.value.trim();
    
    if (!url) {
        if (!testMode) {
            alert('Google Sheets não está configurado. Por favor, preencha a URL do Web App.');
        }
        return Promise.reject('Configurações incompletas');
    }
    
    let payload = {};
    if (testMode) {
        payload = {
            datetime: new Date().toLocaleString('pt-BR'),
            filename: "TESTE_CONEXAO",
            pricingMode: "N/A",
            totalQty: 0,
            totalValue: 0,
            totalDivergences: 0,
            divergentSkus: ["Nenhum"]
        };
    } else {
        if (matchedResults.length === 0) {
            alert('Não há itens reconciliados para registrar.');
            return Promise.reject('Sem resultados');
        }
        
        const salesFileInput = document.getElementById('sales-file-input');
        const filename = salesFileInput.files[0] ? salesFileInput.files[0].name : "relatorio_vendas.csv";
        
        let pricingModeText = "Custo Contábil Fixo";
        if (pricingPDV.checked) {
            pricingModeText = "Preço Real PDV";
        } else if (pricingFator.checked) {
            pricingModeText = `Fator de Ajuste (${slider.value}%)`;
        }
        
        const totalQty = matchedResults.reduce((acc, curr) => acc + curr.qty, 0);
        const totalValue = matchedResults.reduce((acc, curr) => acc + (curr.qty * curr.price), 0);
        
        payload = {
            datetime: new Date().toLocaleString('pt-BR'),
            filename: filename,
            pricingMode: pricingModeText,
            totalQty: totalQty,
            totalValue: totalValue,
            totalDivergences: divergentResults.length,
            divergentSkus: divergentResults.map(d => d.sku)
        };
    }
    
    if (testMode) {
        sheetsTestStatus.style.display = 'block';
        sheetsTestStatus.style.color = 'var(--text-secondary)';
        sheetsTestStatus.textContent = 'Conectando ao Google Sheets...';
    }
    
    // Fazer uma requisição POST usando a API Fetch para a URL do script do Google
    return fetch(url, {
        method: 'POST',
        mode: 'no-cors', // Evita erros estritos de CORS de páginas locais
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (testMode) {
            sheetsTestStatus.style.display = 'block';
            sheetsTestStatus.style.color = 'var(--status-offline)';
            sheetsTestStatus.textContent = 'Requisição de teste enviada! Verifique se uma nova linha apareceu na planilha.';
            setTimeout(() => { sheetsTestStatus.style.display = 'none'; }, 8000);
        } else {
            alert('Registro enviado com sucesso! Verifique a sua Planilha do Google.');
        }
    })
    .catch(error => {
        console.error('Erro no Google Sheets:', error);
        if (testMode) {
            sheetsTestStatus.style.display = 'block';
            sheetsTestStatus.style.color = 'var(--status-error)';
            sheetsTestStatus.textContent = 'Falha ao enviar: ' + error.message;
        } else {
            alert('Erro ao registrar dados no Google Sheets: ' + error.message);
        }
    });
}

// Ouvir clique de teste do Google Sheets
btnTestSheets.addEventListener('click', () => {
    syncToGoogleSheets(true);
});

// Ouvir clique manual de registro do Google Sheets
btnSyncSheets.addEventListener('click', () => {
    syncToGoogleSheets(false);
});

// Exportar CSV Olist-Ready
btnExportOlist.addEventListener('click', () => {
    if (matchedResults.length === 0) {
        alert('Não há itens reconciliados para exportação.');
        return;
    }
    
    // Cabeçalhos padrão baseados no Padrao-produtos-olist.xlsx
    // Código (SKU) | Descrição | Unidade | Quantidade | Preço | Preço de custo
    const headers = ['Código (SKU)', 'Descrição', 'Unidade', 'Quantidade', 'Preço', 'Preço de custo'];
    
    let csvContent = '\uFEFF'; // Adiciona BOM para abrir corretamente no Excel brasileiro
    csvContent += headers.join(';') + '\r\n'; // Usando ponto-e-vírgula como padrão nacional
    
    matchedResults.forEach(r => {
        const row = [
            r.sku,
            `"${r.name.replace(/"/g, '""')}"`, // Protege descrições com aspas
            'UN',
            r.qty,
            r.price.toFixed(2).replace('.', ','), // Formato brasileiro de vírgula decimal
            r.originalCost.toFixed(2).replace('.', ',')
        ];
        csvContent += row.join(';') + '\r\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const today = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `faturamento_consignacao_virtual_para_castor_${today}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Se o auto sync do Google Sheets estiver ativado, dispara a gravação no Sheets
    if (sheetsAutoSyncCheckbox.checked) {
        syncToGoogleSheets(false).catch(err => {
            console.warn('Auto-sync Google Sheets falhou:', err);
        });
    }
    
    alert('Sucesso! Planilha Olist importável baixada. Basta importá-la para emitir suas notas fiscais de venda.');
});

// Inicialização imediata ao carregar a página
window.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => {
        console.log('IndexedDB e aplicação inicializadas.');
        loadSheetsSettings(); // Carrega credenciais salvas no localStorage
    });
});
