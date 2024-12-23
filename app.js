// Make network variable globally accessible
let network = null;
let nodes;
let edges;
let currentSession = null;
let selectedNode = null;
let currentUser = null;

// Rate limiting utilities
const rateLimiter = {
    lastRequestTime: {},
    requestQueue: {},
    
    async throttle(key, minInterval) {
        const now = Date.now();
        if (!this.lastRequestTime[key]) {
            this.lastRequestTime[key] = now;
            return;
        }

        const timeSinceLastRequest = now - this.lastRequestTime[key];
        if (timeSinceLastRequest < minInterval) {
            const delay = minInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime[key] = Date.now();
    },

    async queueRequest(key, requestFn, minInterval = 1000) {
        if (!this.requestQueue[key]) {
            this.requestQueue[key] = Promise.resolve();
        }

        try {
            await this.requestQueue[key];
            await this.throttle(key, minInterval);
            const result = await requestFn();
            return result;
        } finally {
            delete this.requestQueue[key];
        }
    }
};

// Loading indicator
const loadingIndicator = {
    show() {
        const loading = document.createElement('div');
        loading.className = 'loading active';
        loading.innerHTML = 'Loading...';
        document.body.appendChild(loading);
        return loading;
    },

    hide(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }
};

// Initialize the network
function initNetwork() {
    if (!currentUser) return;

    nodes = new vis.DataSet([]);
    edges = new vis.DataSet([]);

    const container = document.getElementById('network');
    const data = {
        nodes: nodes,
        edges: edges
    };
    const options = {
        physics: {
            enabled: true,
            solver: 'barnesHut',
            barnesHut: {
              gravitationalConstant: -1000,
              centralGravity: 0.0,
              springLength: 400,
              springConstant: 0.04,
            },
            stabilization: {
              enabled: true,
              iterations: 1000,
              updateInterval: 25,
            },
          },
          layout: {
            improvedLayout: true,
          },
          nodes: {
            shape: 'dot',
            size: 20,
            font: { size: 14 },
            color: { background: '#97C2FC', border: '#2B7CE9' },
          },
          edges: {
            arrows: {
              to: { enabled: true, scaleFactor: 0.5 },
            },
            color: { color: '#848484', highlight: '#ff0000' },
            width: 2,
            font: { align: 'top' },
          },
          interaction: {
            dragNodes: true,
            dragView: true,
            zoomView: true,
          },
    };

    network = new vis.Network(container, data, options);
    
    network.on('doubleClick', async function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            await expandNode(nodeId);
        }
    });

    network.on('select', function(params) {
        if (params.nodes.length > 0) {
            if(selectedNode)
            {
                document.getElementById(selectedNode).style.background = 'white';
            }
            selectedNode = params.nodes[0];
            const node = nodes.get(selectedNode);
            if (node && node.transactions) {
                updateTransactionTable(node.transactions);
                document.getElementById(selectedNode).style.background = 'red';
            }
        } else {
            selectedNode = null;
        }
    });
}

// Handle user login
function handleUserLogin(user) {
    currentUser = user;
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    document.getElementById('userPhoto').src = user.photoURL || 'https://www.gravatar.com/avatar/?d=mp';
    document.getElementById('userName').textContent = user.displayName || user.email;
    initNetwork();
    loadSessions();
}

// Handle user logout
function handleUserLogout() {
    currentUser = null;
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
    if (network) {
        network.destroy();
        network = null;
    }
    nodes = null;
    edges = null;
    currentSession = null;
    selectedNode = null;
}

// Google Sign In
document.getElementById('googleLogin').addEventListener('click', async () => {
    const loading = loadingIndicator.show();
    try {
        const result = await auth.signInWithPopup(googleProvider);
        handleUserLogin(result.user);
    } catch (error) {
        console.error('Error signing in:', error);
        alert('Error signing in with Google: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
});

// Sign Out
async function signOut() {
    const loading = loadingIndicator.show();
    try {
        await auth.signOut();
        handleUserLogout();
    } catch (error) {
        console.error('Error signing out:', error);
        alert('Error signing out: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

// Load available sessions
async function loadSessions() {
    if (!currentUser) return;

    const select = document.getElementById('sessionSelect');
    select.innerHTML = '<option value="">Select Session</option>';

    const loading = loadingIndicator.show();
    try {
        const snapshot = await db.collection('sessions')
            .where('userId', '==', currentUser.uid)
            .orderBy('created', 'desc')
            .get();
        
        snapshot.forEach(doc => {
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = doc.data().name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading sessions:', error);
        alert('Error loading sessions: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

// Create a new session
async function createSession() {
    if (!currentUser) {
        alert('Please sign in first');
        return;
    }

    const sessionName = document.getElementById('sessionName').value;
    if (!sessionName) {
        alert('Please enter a session name');
        return;
    }

    const loading = loadingIndicator.show();
    try {
        const sessionData = {
            name: sessionName,
            created: firebase.firestore.FieldValue.serverTimestamp(),
            userId: currentUser.uid,
            userEmail: currentUser.email,
            nodes: [],
            edges: [],
            lastTransactions: []
        };

        const docRef = await db.collection('sessions').add(sessionData);
        currentSession = { id: docRef.id, ...sessionData };
        
        if (nodes) nodes.clear();
        if (edges) edges.clear();

        alert('Session created successfully');
        await loadSessions();
    } catch (error) {
        console.error('Error creating session:', error);
        alert('Error creating session: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

// Calculate account summary for a node
function calculateAccountSummary(node) {
    if (!node || !node.transactions) return null;

    const summary = {
        address: node.id,
        type: node.cryptoType,
        totalSent: 0,
        totalReceived: 0,
        transactionCount: node.transactions.length,
        tags: node.tags || [],
        lastActivity: null
    };

    node.transactions.forEach(tx => {
        const amount = parseFloat(tx.amount);
        if (tx.from === node.id) {
            summary.totalSent += amount;
        }
        if (tx.to === node.id) {
            summary.totalReceived += amount;
        }
        const txTime = new Date(tx.timestamp);
        if (!summary.lastActivity || txTime > new Date(summary.lastActivity)) {
            summary.lastActivity = tx.timestamp;
        }
    });

    summary.balance = summary.totalReceived - summary.totalSent;
    return summary;
}

// Update accounts table
function updateAccountsTable() {
    const tbody = document.querySelector('#accountsTable tbody');
    if (!tbody) {
        console.error('Accounts table not found');
        return;
    }

    tbody.innerHTML = '';
    const nodeIds = nodes.getIds();
    const summaries = [];

    nodeIds.forEach(nodeId => {
        const node = nodes.get(nodeId);
        if (node && node.transactions) {
            const summary = calculateAccountSummary(node);
            if (summary) {
                summaries.push(summary);
            }
        }
    });

    // Sort summaries by transaction count (descending)
    summaries.sort((a, b) => b.transactionCount - a.transactionCount);

    summaries.forEach(summary => {
        const row = document.createElement('tr');
        row.id = summary.address;
        var createClickHandler = function(row) {
            return function() {
                if(selectedNode)
                {
                    document.getElementById(selectedNode).style.background = 'white';
                }
                selectedNode = row.id;
                row.style.background = 'red';
            };
          };
        row.innerHTML = `
            <td>${summary.address}</td>
            <td>${summary.type}</td>
            <td>${summary.totalSent.toFixed(4)} ${summary.type}</td>
            <td>${summary.totalReceived.toFixed(4)} ${summary.type}</td>
            <td>${summary.balance.toFixed(4)} ${summary.type}</td>
            <td>${summary.transactionCount}</td>
            <td>${summary.tags}</td>
            <td>${new Date(summary.lastActivity).toLocaleString()}</td>
        `;
        row.onclick = createClickHandler(row);
        tbody.appendChild(row);
    });
}

// Update transaction table
function updateTransactionTable(transactions) {
    if (!transactions || !Array.isArray(transactions)) {
        console.warn('No transactions to display');
        return;
    }

    const tbody = document.querySelector('#transactionTable tbody');
    if (!tbody) {
        console.error('Transaction table not found');
        return;
    }

    tbody.innerHTML = '';
    transactions.forEach(tx => {
        const row = document.createElement('tr');
        row.id = tx.hash;
        row.innerHTML = `
            <td>${tx.from ? tx.from : 'N/A'}</td>
            <td>${tx.to ? tx.to: 'N/A'}</td>
            <td>${tx.amount} ${tx.currency}</td>
            <td>${new Date(tx.timestamp).toLocaleString()}</td>
            <td>${tx.currency}</td>
        `;
        tbody.appendChild(row);
    });
}

// Load a specific session
async function loadSession(sessionId) {
    if (!currentUser || !sessionId) return;

    const loading = loadingIndicator.show();
    try {
        const doc = await db.collection('sessions').doc(sessionId).get();
        
        if (!doc.exists) {
            throw new Error('Session not found');
        }

        const sessionData = doc.data();
        if (sessionData.userId !== currentUser.uid) {
            throw new Error('Unauthorized access to session');
        }

        // Clear existing data
        if (nodes) nodes.clear();
        if (edges) edges.clear();

        // Initialize network if not already initialized
        if (!network) {
            initNetwork();
        }

        // Store current session
        currentSession = {
            id: doc.id,
            ...sessionData
        };

        // Add nodes with all properties
        let nodeTransactions = [];
        if (Array.isArray(sessionData.nodes)) {
            const nodeArray = sessionData.nodes.map(node => {
                // Collect transactions from node data if available
                if (node.transactions) {
                    nodeTransactions = nodeTransactions.concat(node.transactions);
                }
                let tag_value = '';
                let node_color = '#62688F';
                if(node.tags && node.tags.length > 0) {
                    tag_value = '\n' + node.tags.join(', ');
                    for(let i = 0; i < node.tags.length; i++)
                    {
                        if(node.tags[i].indexOf("Fund") > -1 || node.tags[i].indexOf("Deposit") > -1)
                        {
                            node_color = 'red';
                        }
                        if(node.tags[i].indexOf("Victim") > -1)
                        {
                            node_color = 'blue';
                        }
                    }
                }

                return {
                    id: node.id,
                    label: node.label || node.id,
                    title: node.title || node.id,
                    color: node_color,
                    tags: node.tags || [],
                    cryptoType: node.cryptoType,
                    transactions: node.transactions || []
                };
            });
            nodes.add(nodeArray);
        }

        // Add edges with all properties
        if (Array.isArray(sessionData.edges)) {
            const edgeArray = sessionData.edges.map(edge => ({
                from: edge.from,
                to: edge.to,
                arrows: 'to',
                count: 1,
                label: edge.label || `${edge.amount} ${edge.currency}`,
                //color: { color: edge.cryptoType === 'ETH' ? '#62688F' : '#F7931A' }
            }));
            var newEdgeArray = [];
            for(let i = 0; i < edgeArray.length; i++)
            {
                let edge =await edgeArrayExists(newEdgeArray, edgeArray[i].from, edgeArray[i].to);
                if(edge == null)
                {
                    newEdgeArray.push(edgeArray[i]);
                }
                else
                {
                    edge.count = edge.count +1;
                    edge.amount = edge.amount + edgeArray[i].amount;
                    edge.label = `${edge.amount} ${edge.currency} (${edge.count})`;
                }
            }
            edges.add(newEdgeArray);
        }

        // Update the session name input
        const sessionNameInput = document.getElementById('sessionName');
        if (sessionNameInput) {
            sessionNameInput.value = sessionData.name || '';
        }

        // Update transaction table with collected transactions
        if (nodeTransactions.length > 0) {
            updateTransactionTable(nodeTransactions);
            currentSession.lastTransactions = nodeTransactions;
        }

        // Update accounts table
        updateAccountsTable();

        // Force network redraw and fit
        if (network) {
            network.setData({ nodes: nodes, edges: edges });
            //setTimeout(() => {
            //    network.redraw();
            //    network.fit();
            //}, 500);
        }

        console.log('Session loaded successfully:', {
            sessionId,
            name: sessionData.name,
            nodeCount: nodes.get().length,
            edgeCount: edges.get().length,
            transactionCount: nodeTransactions.length
        });
    } catch (error) {
        console.error('Error loading session:', error);
        alert('Error loading session: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

// Save current session state
async function saveSessionState() {
    if (!currentUser || !currentSession) return;

    const loading = loadingIndicator.show();
    try {
        const sessionData = {
            nodes: nodes.get(),
            edges: edges.get(),
            lastModified: firebase.firestore.FieldValue.serverTimestamp(),
            name: document.getElementById('sessionName').value || currentSession.name,
            lastTransactions: currentSession.lastTransactions || []
        };

        await db.collection('sessions').doc(currentSession.id).update(sessionData);
    } catch (error) {
        console.error('Error saving session:', error);
        alert('Error saving session: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

async function edgeArrayExists(edgeArray, from, to) {
    for(let i = 0; i < edgeArray.length; i++)
    {
        if(edgeArray[i].from === from && edgeArray[i].to === to)
        {
            return edgeArray[i];
        }
    }
    return null;
}

function edgeExists(from, to) {
    ret = edges.get({ filter: (edge) => edge.from === from && edge.to === to });
    if(ret.length > 0)
    {
        return ret[0];
    }
    return null;
}
async function expandNode(nodeId) {
    const node = nodes.get(nodeId);
    
    if (!currentUser) {
        alert('Please sign in first');
        return;
    }

    if (!currentSession) {
        alert('Please create or select a session first');
        return;
    }

    const address = node.id;
    const cryptoType = node.cryptoType;
    
    if (!address) {
        alert('Please enter an address');
        return;
    }

    const loading = loadingIndicator.show();
    try {
        const transactions = cryptoType === 'ETH' 
            ? await fetchEthTransactions(address)
            : await fetchBtcTransactions(address);

        // Add related nodes and edges
        transactions.forEach(async tx => {
            if(!nodes.get(tx.to)) {
                nodes.add({
                    id: tx.to,
                    label: tx.to,
                    title: tx.to,
                    cryptoType: cryptoType,
                    color: cryptoType === 'ETH' ? '#62688F' : '#F7931A',
                    transactions: [tx]
                });
            }
            else {
                const existingNode = nodes.get(tx.to);
                if (!existingNode.transactions) {
                    existingNode.transactions = [];
                }
                existingNode.transactions.push(tx);
                nodes.update(existingNode);
            }
            if (!nodes.get(tx.from)) {
                nodes.add({
                    id: tx.from,
                    label: tx.from,
                    title: tx.from,
                    cryptoType: cryptoType,
                    color: cryptoType === 'ETH' ? '#62688F' : '#F7931A',
                    transactions: [tx]
                });
                
            } else {
                const existingNode = nodes.get(tx.from);
                if (!existingNode.transactions) {
                    existingNode.transactions = [];
                }
                existingNode.transactions.push(tx);
                nodes.update(existingNode);
            }
            let edge = edgeExists(tx.from, tx.to);
            if(edge == null)
            {
                edges.add({
                    from: tx.from,
                    to: tx.to,
                    label: `${tx.amount} ${cryptoType}`,
                    arrows: 'to',
                    count: 1,
                    amount: parseFloat(tx.amount),
                    color: { color: cryptoType === 'ETH' ? '#62688F' : '#F7931A' }
                });
            }
            else
            {
                edge.amount = edge.amount + parseFloat(tx.amount);
                edge.count = edge.count + 1;
                edge.label = `${edge.amount} ${edge.currency}`;
                edges.update(edge);
            }
        });

        // Update current session with the new data
        currentSession.lastTransactions = transactions;
        await saveSessionState();

        // Update transaction table
        updateTransactionTable(transactions);

        // Update accounts table
        updateAccountsTable();

        // Refresh network visualization
        if (network) {
            //network.setData({ nodes: nodes, edges: edges });
            //setTimeout(() => {
                //network.redraw();
                //network.fit();
            //}, 500);
        }
    } catch (error) {
        console.error('Error adding address:', error);
        alert('Error adding address: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
        document.getElementById('addressInput').value = '';
    }
}

function applyExpand() {
    if (!currentUser || !currentSession) return;
    if (!selectedNode) {
        alert('Please select a node first');
        return;
    }

    expandNode(selectedNode);
}
// Add a new address to the network
async function addAddress() {
    if (!currentUser) {
        alert('Please sign in first');
        return;
    }

    if (!currentSession) {
        alert('Please create or select a session first');
        return;
    }

    const address = document.getElementById('addressInput').value;
    const cryptoType = document.getElementById('cryptoType').value;
    
    if (!address) {
        alert('Please enter an address');
        return;
    }

    const loading = loadingIndicator.show();
    try {
        var transactions = [];
        if (cryptoType === 'BTC')
            transactions = await fetchBtcTransactions(address);
        else if (cryptoType === 'DOMAIN')
            transactions = await fetchDomainTransactions(address);
        else
            transactions = await fetchEthTransactions(address)
        
        // Add main address node with its transactions
        if (!nodes.get("main")) {
            nodes.add({
                id: 'main',
                label: 'main',
                title: 'main',
                color: cryptoType === 'ETH' ? '#FF0000' : '#FF0000',
                cryptoType: cryptoType,
                transactions: transactions
            });
        }
        if (!nodes.get(address.toLowerCase())) {
            nodes.add({
                id: address.toLowerCase(),
                label: address.toLowerCase(),
                title: address.toLowerCase(),
                color: cryptoType === 'ETH' ? '#FF0000' : '#FF0000',
                cryptoType: cryptoType,
                transactions: transactions
            });
        }

        // Add related nodes and edges
        transactions.forEach(async tx => {
            if(!nodes.get(tx.to)) {
                nodes.add({
                    id: tx.to,
                    label: tx.to,
                    title: tx.to,
                    cryptoType: cryptoType,
                    color: cryptoType === 'ETH' ? '#62688F' : '#F7931A',
                    transactions: [tx]
                });
            }
            else {
                const existingNode = nodes.get(tx.to);
                if (!existingNode.transactions) {
                    existingNode.transactions = [];
                }
                existingNode.transactions.push(tx);
                nodes.update(existingNode);
            }
            if (!nodes.get(tx.from)) {
                nodes.add({
                    id: tx.from,
                    label: tx.from,
                    title: tx.from,
                    cryptoType: cryptoType,
                    color: cryptoType === 'ETH' ? '#62688F' : '#F7931A',
                    transactions: [tx]
                });
                
            } else {
                const existingNode = nodes.get(tx.from);
                if (!existingNode.transactions) {
                    existingNode.transactions = [];
                }
                existingNode.transactions.push(tx);
                nodes.update(existingNode);
            }
            let edge = edgeExists(tx.from, tx.to);
            if(edge == null)
            {
                edges.add({
                    from: tx.from,
                    to: tx.to,
                    label: `${tx.amount} ${cryptoType} (1)`,
                    arrows: 'to',
                    count: 1,
                    amount: parseFloat(tx.amount),
                    color: { color: cryptoType === 'ETH' ? '#62688F' : '#F7931A' }
                });
            }
            else
            {
                edge.amount = edge.amount + parseFloat(tx.amount);
                edge.count = edge.count + 1;
                edge.label = `${edge.amount} ${edge.currency} (${edge.count})`;
                edges.update(edge);
            }
        });

        // Update current session with the new data
        currentSession.lastTransactions = transactions;
        await saveSessionState();

        // Update transaction table
        updateTransactionTable(transactions);

        // Update accounts table
        updateAccountsTable();

        // Refresh network visualization
        if (network) {
            network.setData({ nodes: nodes, edges: edges });
            setTimeout(() => {
                //network.redraw();
                //network.fit();
            }, 500);
        }
    } catch (error) {
        console.error('Error adding address:', error);
        alert('Error adding address: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
        document.getElementById('addressInput').value = '';
    }
}

// Fetch Ethereum transactions
async function fetchDomainTransactions(address) {
    if (!window.blockchainConfig || !window.blockchainConfig.ethereum) {
        throw new Error('Ethereum configuration not found');
    }

    return rateLimiter.queueRequest('domain', async () => {
        const response = await fetch(
            `https://urlscan.io/api/v1/search/?q=domain:${address}`
        );
        
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        const data = await response.json();
        
        if (data.results.length > 0) {
            return data.results.map(result => ({
                type:'domain',
                from: address,
                to: result.page.ip,
                value: result.page.ip,
                currency:'domain',
                timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString()
            }))
        }
        
        }, 5000);
}

async function fetchEthTransactions(address) {
    if (!window.blockchainConfig || !window.blockchainConfig.ethereum) {
        throw new Error('Ethereum configuration not found');
    }

    return rateLimiter.queueRequest('ethereum', async () => {
        const response = await fetch(
            `${window.blockchainConfig.ethereum.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${window.blockchainConfig.ethereum.apiKey}`
        );
        
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        const data = await response.json();
        
        if (data.status === '1' && data.result) {
            return data.result.map(tx => ({
                from: tx.from,
                to: tx.to,
                type:'ETH',
                amount: (parseFloat(tx.value) / 1e18).toFixed(4),
                currency: 'ETH',
                timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
                hash: tx.hash
            }));
        }
        throw new Error(data.message || 'Failed to fetch Ethereum transactions');
    }, 5000);
}

// Fetch Bitcoin transactions
async function fetchBtcTransactions(address) {
    if (!window.blockchainConfig || !window.blockchainConfig.bitcoin) {
        throw new Error('Bitcoin configuration not found');
    }

    return rateLimiter.queueRequest('bitcoin', async () => {
        const response = await fetch(
            `${window.blockchainConfig.bitcoin.apiUrl}/rawaddr/${address}`
        );
        
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        const data = await response.json();
        
        return data.txs.slice(0, 10).map(tx => {
            const isIncoming = tx.out.some(output => output.addr === address);
            return {
                from: isIncoming ? tx.inputs[0].prev_out.addr : address,
                to: isIncoming ? address : tx.out[0].addr,
                amount: (tx.out[0].value / 1e8).toFixed(8),
                currency: 'BTC',
                type:'BTC',
                timestamp: new Date(tx.time * 1000).toISOString(),
                hash: tx.hash
            };
        });
    }, 10000);
}

// Add label to selected node
async function addLabel() {
    if (!currentUser || !currentSession) return;
    if (!selectedNode) {
        alert('Please select a node first');
        return;
    }

    const label = document.getElementById('labelInput').value;
    if (!label) {
        alert('Please enter a label');
        return;
    }

    const loading = loadingIndicator.show();
    try {
        var node = nodes.get(selectedNode);
        if(node.tags)
            node.tags.push(label); 
        else
            node.tags = [label];
        nodes.update(node);
        row = document.getElementById(selectedNode);
        if(row)
        {
            row.getElementsByTagName("td")[6].innerHTML = node.tags.join(", ");
        }
        await saveSessionState();
    } catch (error) {
        console.error('Error adding label:', error);
        alert('Error adding label: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
        document.getElementById('labelInput').value = '';
    }
}

// Change color of selected node
async function applyColor() {
    if (!currentUser || !currentSession) return;
    if (!selectedNode) {
        alert('Please select a node first');
        return;
    }

    const loading = loadingIndicator.show();
    try {
        const color = document.getElementById('colorPicker').value;
        nodes.update({
            id: selectedNode,
            color: color
        });

        await saveSessionState();
    } catch (error) {
        console.error('Error applying color:', error);
        alert('Error applying color: ' + error.message);
    } finally {
        loadingIndicator.hide(loading);
    }
}

// Event listener for tab switching
document.addEventListener('DOMContentLoaded', function() {
    // Initialize authentication state
    auth.onAuthStateChanged((user) => {
        if (user) {
            handleUserLogin(user);
        } else {
            handleUserLogout();
        }
    });

    // Set up tab switching
    const tabs = document.querySelectorAll('.tab-button');
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            const tabId = this.getAttribute('data-tab');
            if (!tabId) return;

            // Hide all tab panes
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            
            // Deactivate all tab buttons
            tabs.forEach(t => t.classList.remove('active'));
            
            // Show selected tab pane
            document.getElementById(tabId).classList.add('active');
            
            // Activate selected tab button
            this.classList.add('active');
        });
    });
});
