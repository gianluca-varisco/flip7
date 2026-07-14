// Configurazione e Stato Globale
let peer = null;
let conn = null; // Usato dal Client per comunicare con l'Host
let connections = []; // Lista di tutte le connessioni attive (usato dall'Host)
let isHost = false;
let myPeerId = "";
let myNickname = "";

// Stato del Gioco
let players = []; // { id, name, score, active }
let activePlayerIndex = 0;
let deck = [];
let currentTurnCards = [];
let hasDouble = false;
let hasHeart = false;
let isGameOver = false;

// Configurazione mazzo Flip 7 standard
const CARD_TYPES = {
    NUMBER: 'number',
    FREEZE: 'freeze',
    DOUBLE: 'double',
    HEART: 'heart'
};

function createDeck() {
    let newDeck = [];
    
    // Carte numeriche: 1x '1', 2x '2', ... fino a 12x '12'
    for (let i = 1; i <= 12; i++) {
        for (let j = 0; j < i; j++) {
            newDeck.push({ type: CARD_TYPES.NUMBER, value: i });
        }
    }
    
    // Carte speciali (quantità indicative per bilanciamento)
    for (let i = 0; i < 4; i++) newDeck.push({ type: CARD_TYPES.FREEZE, value: 'FREEZE' });
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.DOUBLE, value: 'x2' });
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.HEART, value: '♥' });
    
    // Mischia il mazzo (Fisher-Yates)
    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    
    return newDeck;
}

// --- LOGICA DI RETE (PEERJS) ---

// Inizializza PeerJS
function initPeer(callback) {
    peer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        pingInterval: 5000
    });
    
    peer.on('open', (id) => {
        myPeerId = id;
        callback(id);
    });

    peer.on('error', (err) => {
        console.error("Errore PeerJS:", err);
        alert("Errore di connessione a PeerJS: " + err.type);
    });
}

// Avvia come Host
function startHost() {
    myNickname = prompt("Inserisci il tuo Nickname:") || "Host";
    initPeer((id) => {
        isHost = true;
        document.getElementById('host-id-display').innerText = "ID Partita: " + id;
        document.getElementById('btn-host').disabled = true;
        document.getElementById('btn-join').disabled = true;
        document.getElementById('join-id').disabled = true;
        
        // Aggiungi te stesso ai giocatori
        players.push({ id: id, name: myNickname, score: 0, active: true });
        updatePlayerListUI();
        document.getElementById('player-list-container').style.display = 'block';
        document.getElementById('btn-start-game').style.display = 'inline-block';
        
        // Ascolta le connessioni in entrata
        peer.on('connection', (connection) => {
            connections.push(connection);
            setupHostConnection(connection);
        });
    });
}

// Configura eventi per l'Host sulla connessione di un Client
function setupHostConnection(connection) {
    connection.on('open', () => {
        // Appena il canale è aperto, l'Host richiede esplicitamente il nickname
        connection.send({ type: 'REQUEST_NICKNAME' });
    });

    connection.on('data', (data) => {
        if (data.type === 'SEND_NICKNAME') {
            // Verifica che il giocatore non sia già presente
            if (!players.some(p => p.id === connection.peer)) {
                players.push({ id: connection.peer, name: data.nickname, score: 0, active: true });
                updatePlayerListUI();
                
                // Comunica la lista aggiornata a tutti i client connessi
                broadcast({ type: 'UPDATE_PLAYERS', players: players });
            }
        }
        
        if (data.type === 'ACTION_FLIP') {
            handleFlipAction();
        }
        
        if (data.type === 'ACTION_STOP') {
            handleStopAction();
        }
    });

    connection.on('close', () => {
        // Rimuove il giocatore se si disconnette prima o durante la partita
        players = players.filter(p => p.id !== connection.peer);
        connections = connections.filter(c => c.peer !== connection.peer);
        updatePlayerListUI();
        broadcast({ type: 'UPDATE_PLAYERS', players: players });
    });
}

// Unisciti come Client
function joinGame() {
    const hostId = document.getElementById('join-id').value.trim();
    if (!hostId) {
        alert("Inserisci un ID Host valido!");
        return;
    }
    
    myNickname = prompt("Inserisci il tuo Nickname:") || "Giocatore";
    
    initPeer((id) => {
        isHost = false;
        conn = peer.connect(hostId);
        
        conn.on('open', () => {
            document.getElementById('lobby').style.display = 'none';
            document.getElementById('table').style.display = 'block';
            document.getElementById('turn-indicator').innerText = "Connesso! In attesa che l'host avvii la partita...";
        });
        
        conn.on('data', (data) => {
            if (data.type === 'REQUEST_NICKNAME') {
                conn.send({ type: 'SEND_NICKNAME', nickname: myNickname });
            }
            if (data.type === 'UPDATE_PLAYERS') {
                players = data.players;
                updateScoresUI();
            }
            if (data.type === 'START_GAME_CLIENT') {
                document.getElementById('lobby').style.display = 'none';
                document.getElementById('table').style.display = 'block';
            }
            if (data.type === 'UPDATE_STATE') {
                players = data.players;
                activePlayerIndex = data.activePlayerIndex;
                currentTurnCards = data.currentTurnCards;
                updateScoresUI();
                renderCurrentCards();
                updateTurnControls();
            }
        });

        conn.on('close', () => {
            alert("Connessione con l'Host interrotta.");
            location.reload();
        });
    });
}

// Invia dati a tutti i partecipanti (solo Host)
function broadcast(data) {
    if (!isHost) return;
    connections.forEach(c => {
        if (c.open) {
            c.send(data);
        }
    });
}

// --- INTERFACCIA UTENTE (UI) ---

function updatePlayerListUI() {
    const list = document.getElementById('player-list');
    list.innerHTML = "";
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name + (p.id === myPeerId ? " (Tu)" : "");
        list.appendChild(li);
    });
}

function updateScoresUI() {
    const list = document.getElementById('scores-list');
    list.innerHTML = "";
    players.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = `score-row ${idx === activePlayerIndex ? 'active-turn' : ''}`;
        div.innerHTML = `<span>${p.name} ${idx === activePlayerIndex ? '⚡' : ''}</span> <span>${p.score} pt</span>`;
        list.appendChild(div);
    });
}

function renderCurrentCards() {
    const container = document.getElementById('current-row');
    container.innerHTML = "";
    currentTurnCards.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        
        if (card.type === CARD_TYPES.FREEZE) cardDiv.classList.add('special-freeze');
        if (card.type === CARD_TYPES.DOUBLE) cardDiv.classList.add('special-double');
        if (card.type === CARD_TYPES.HEART) cardDiv.classList.add('special-heart');
        
        cardDiv.innerHTML = `
            <div class="card-corner">${card.value}</div>
            <div class="card-value">${card.value}</div>
            <div class="card-corner bottom">${card.value}</div>
        `;
        container.appendChild(cardDiv);
    });
}

function updateTurnControls() {
    const isMyTurn = (players[activePlayerIndex] && players[activePlayerIndex].id === myPeerId);
    
    document.getElementById('btn-flip').disabled = !isMyTurn;
    document.getElementById('btn-stop').disabled = !isMyTurn || currentTurnCards.length === 0;
    
    const turnIndicator = document.getElementById('turn-indicator');
    if (isMyTurn) {
        turnIndicator.innerText = "Tocca a te! Gira una carta o fermati.";
        turnIndicator.style.backgroundColor = '#ffd700';
    } else {
        const activeName = players[activePlayerIndex] ? players[activePlayerIndex].name : "...";
        turnIndicator.innerText = `Turno di ${activeName}...`;
        turnIndicator.style.backgroundColor = '#2e5c43';
    }
}

// --- LOGICA DEL GIOCO ---

function startGame() {
    if (!isHost) return;
    
    deck = createDeck();
    activePlayerIndex = 0;
    currentTurnCards = [];
    hasDouble = false;
    hasHeart = false;
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('table').style.display = 'block';
    
    broadcast({ type: 'START_GAME_CLIENT' });
    sendGameState();
}

function sendGameState() {
    const state = {
        players: players,
        activePlayerIndex: activePlayerIndex,
        currentTurnCards: currentTurnCards
    };
    
    if (isHost) {
        // Aggiorna UI locale
        updateScoresUI();
        renderCurrentCards();
        updateTurnControls();
        // Invia aggiornamento ai client
        broadcast({ type: 'UPDATE_STATE', ...state });
    }
}

// Azione di Pesca (Flip)
function playerFlip() {
    if (isHost) {
        handleFlipAction();
    } else {
        conn.send({ type: 'ACTION_FLIP' });
    }
}

function handleFlipAction() {
    if (deck.length === 0) {
        deck = createDeck(); // Rigenera il mazzo se finisce
    }
    
    const card = deck.pop();
    
    // Controlla se sballa (Bust)
    let isBust = false;
    
    if (card.type === CARD_TYPES.NUMBER) {
        // Se il numero è già presente nella fila, sballi
        const duplicate = currentTurnCards.find(c => c.type === CARD_TYPES.NUMBER && c.value === card.value);
        if (duplicate) {
            isBust = true;
        }
    }
    
    currentTurnCards.push(card);
    
    // Gestione carte speciali
    if (card.type === CARD_TYPES.DOUBLE) {
        hasDouble = true;
    }
    if (card.type === CARD_TYPES.HEART) {
        hasHeart = true;
    }
    
    if (isBust) {
        if (hasHeart) {
            // Se possiede una carta cuore, la consuma e si salva
            hasHeart = false;
            // Rimuovi l'ultimo duplicato o la carta speciale cuore appena pescata per salvarlo
            const heartIdx = currentTurnCards.findIndex(c => c.type === CARD_TYPES.HEART);
            if (heartIdx > -1) currentTurnCards.splice(heartIdx, 1);
            alert("Sballato! Ma la carta Cuore ti ha salvato la vita!");
        } else {
            alert("Sballato (Bust)! Fai 0 punti in questo turno.");
            currentTurnCards = [];
            hasDouble = false;
            hasHeart = false;
            nextTurn();
            return;
        }
    }
    
    // Se è un FREEZE, il turno si interrompe immediatamente consolidando i punti
    if (card.type === CARD_TYPES.FREEZE) {
        alert("Hai pescato un Freeze! Il tuo turno termina qui con successo.");
        handleStopAction();
        return;
    }
    
    sendGameState();
}

// Azione di Stop (Bank)
function playerStop() {
    if (isHost) {
        handleStopAction();
    } else {
        conn.send({ type: 'ACTION_STOP' });
    }
}

function handleStopAction() {
    // Calcola il punteggio della fila
    let turnScore = 0;
    
    currentTurnCards.forEach(c => {
        if (c.type === CARD_TYPES.NUMBER) {
            turnScore += c.value;
        }
    });
    
    if (hasDouble) {
        turnScore *= 2;
    }
    
    players[activePlayerIndex].score += turnScore;
    
    // Reset stato del turno
    currentTurnCards = [];
    hasDouble = false;
    hasHeart = false;
    
    // Controlla se qualcuno ha raggiunto la soglia di vittoria (200 punti)
    if (players[activePlayerIndex].score >= 200) {
        alert(`Il giocatore ${players[activePlayerIndex].name} ha vinto la partita raggiungendo ${players[activePlayerIndex].score} punti!`);
    }
    
    nextTurn();
}

function nextTurn() {
    activePlayerIndex = (activePlayerIndex + 1) % players.length;
    sendGameState();
}