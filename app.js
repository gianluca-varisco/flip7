// Configurazione e Stato Globale
let peer = null;
let conn = null; // Usato dal Client per comunicare con l'Host
let connections = []; // Lista di tutte le connessioni attive (usato dall'Host)
let isHost = false;
let myPeerId = "";
let myNickname = "";

// Stato del Gioco
let players = []; // { id, name, score, active, busted, banked }
let activePlayerIndex = 0;
let deck = [];
let currentTurnCards = [];
let hasDouble = false;
let hasHeart = false;
let isGameOver = false;
let isProcessingAction = false; // Evita clic multipli durante le animazioni temporizzate

// Configurazione mazzo Flip 7 standard + Carta Pesca 3
const CARD_TYPES = {
    NUMBER: 'number',
    FREEZE: 'freeze',
    DOUBLE: 'double',
    HEART: 'heart',
    THREE_STRIKES: 'three_strikes' // Nuova carta speciale
};

// Genera un ID corto di 4 caratteri
function generateShortId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

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
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.THREE_STRIKES, value: '👉 3' }); // 3 Carte Pesca Tre
    
    // Mischia il mazzo (Fisher-Yates)
    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    
    return newDeck;
}

// --- LOGICA DI RETE (PEERJS) ---

function initPeer(customId, callback) {
    peer = new Peer(customId, {
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
        if (err.type === 'unavailable-id') {
            if (isHost) {
                startHost();
            } else {
                alert("Impossibile connettersi. L'ID potrebbe essere errato.");
            }
        } else {
            alert("Errore di connessione a PeerJS: " + err.type);
        }
    });
}

function startHost() {
    myNickname = prompt("Inserisci il tuo Nickname:") || "Host";
    const shortId = generateShortId();
    
    isHost = true;
    
    initPeer(shortId, (id) => {
        document.getElementById('host-id-display').innerText = "ID Partita: " + id;
        document.getElementById('btn-host').disabled = true;
        document.getElementById('btn-join').disabled = true;
        document.getElementById('join-id').disabled = true;
        
        players = [{ id: id, name: myNickname, score: 0, active: true, busted: false, banked: false }];
        updatePlayerListUI();
        document.getElementById('player-list-container').style.display = 'block';
        document.getElementById('btn-start-game').style.display = 'inline-block';
        
        peer.on('connection', (connection) => {
            connections.push(connection);
            setupHostConnection(connection);
        });
    });
}

function setupHostConnection(connection) {
    connection.on('open', () => {
        connection.send({ type: 'REQUEST_NICKNAME' });
    });

    connection.on('data', (data) => {
        if (data.type === 'SEND_NICKNAME') {
            if (!players.some(p => p.id === connection.peer)) {
                players.push({ id: connection.peer, name: data.nickname, score: 0, active: true, busted: false, banked: false });
                updatePlayerListUI();
                broadcast({ type: 'UPDATE_PLAYERS', players: players });
            }
        }
        
        if (isProcessingAction) return;

        if (data.type === 'ACTION_FLIP') {
            handleFlipAction();
        }
        if (data.type === 'ACTION_STOP') {
            handleStopAction();
        }
        if (data.type === 'ASSIGN_THREE_STRIKES') {
            executeThreeStrikesAssignment(data.targetId);
        }
    });

    connection.on('close', () => {
        players = players.filter(p => p.id !== connection.peer);
        connections = connections.filter(c => c.peer !== connection.peer);
        updatePlayerListUI();
        broadcast({ type: 'UPDATE_PLAYERS', players: players });
    });
}

function joinGame() {
    const hostId = document.getElementById('join-id').value.trim().toUpperCase();
    if (!hostId) {
        alert("Inserisci un ID Host valido!");
        return;
    }
    
    myNickname = prompt("Inserisci il tuo Nickname:") || "Giocatore";
    isHost = false;
    
    initPeer(undefined, (id) => {
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
                isProcessingAction = data.isProcessingAction || false;
                updateScoresUI();
                renderCurrentCards();
                updateTurnControls();
                
                // Gestione visibilità selezione bersaglio
                if (data.showTargetSelectionFor === myPeerId) {
                    showTargetSelection(data.eligibleTargets);
                } else {
                    hideTargetSelection();
                }
            }
            if (data.type === 'GAME_OVER') {
                alert(`Fine Partita!\n\nIl giocatore ${data.winnerName} ha vinto con ${data.score} punti!`);
            }
            if (data.type === 'ALERT') {
                alert(data.message);
            }
        });

        conn.on('close', () => {
            alert("Connessione con l'Host interrotta.");
            location.reload();
        });
    });
}

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
        let status = '';
        if (p.busted) status = ' (SBALLATO)';
        if (p.banked) status = ' (FERMO)';
        div.innerHTML = `<span>${p.name} ${idx === activePlayerIndex ? '⚡' : ''}${status}</span> <span>${p.score} pt</span>`;
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
        if (card.type === CARD_TYPES.THREE_STRIKES) cardDiv.classList.add('special-heart'); // Arancione
        
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
    
    document.getElementById('btn-flip').disabled = !isMyTurn || isProcessingAction;
    // Permetti sempre di fermarsi se ci sono carte in tavola
    document.getElementById('btn-stop').disabled = !isMyTurn || currentTurnCards.length === 0 || isProcessingAction;
    
    const turnIndicator = document.getElementById('turn-indicator');
    if (isProcessingAction) {
        turnIndicator.innerText = "Svelando o applicando effetti...";
        turnIndicator.style.backgroundColor = '#d2691e';
    } else if (isMyTurn) {
        turnIndicator.innerText = "Tocca a te! Gira una carta o fermati.";
        turnIndicator.style.backgroundColor = '#ffd700';
    } else {
        const activeName = players[activePlayerIndex] ? players[activePlayerIndex].name : "...";
        turnIndicator.innerText = `Turno di ${activeName}...`;
        turnIndicator.style.backgroundColor = '#2e5c43';
    }
}

function showTargetSelection(eligibleTargets) {
    const area = document.getElementById('target-selection-area');
    const container = document.getElementById('target-buttons');
    container.innerHTML = "";
    
    eligibleTargets.forEach(t => {
        const btn = document.createElement('button');
        btn.innerText = t.name;
        btn.style.margin = "5px";
        btn.onclick = () => selectTarget(t.id);
        container.appendChild(btn);
    });
    
    area.style.display = "block";
}

function hideTargetSelection() {
    document.getElementById('target-selection-area').style.display = "none";
}

function selectTarget(targetId) {
    hideTargetSelection();
    if (isHost) {
        executeThreeStrikesAssignment(targetId);
    } else {
        conn.send({ type: 'ASSIGN_THREE_STRIKES', targetId: targetId });
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
    isProcessingAction = false;
    
    players.forEach(p => {
        p.score = 0;
        p.busted = false;
        p.banked = false;
    });
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('table').style.display = 'block';
    
    broadcast({ type: 'START_GAME_CLIENT' });
    sendGameState();
}

function sendGameState(customTargetId = null, eligibleTargets = []) {
    const state = {
        players: players,
        activePlayerIndex: activePlayerIndex,
        currentTurnCards: currentTurnCards,
        isProcessingAction: isProcessingAction,
        showTargetSelectionFor: customTargetId,
        eligibleTargets: eligibleTargets
    };
    
    if (isHost) {
        updateScoresUI();
        renderCurrentCards();
        updateTurnControls();
        
        if (customTargetId === myPeerId) {
            showTargetSelection(eligibleTargets);
        } else {
            hideTargetSelection();
        }
        
        broadcast({ type: 'UPDATE_STATE', ...state });
    }
}

function playerFlip() {
    if (isProcessingAction) return;

    if (isHost) {
        handleFlipAction();
    } else {
        conn.send({ type: 'ACTION_FLIP' });
    }
}

function handleFlipAction() {
    if (deck.length === 0) {
        deck = createDeck();
    }
    
    const card = deck.pop();
    let isBust = false;
    
    if (card.type === CARD_TYPES.NUMBER) {
        const duplicate = currentTurnCards.find(c => c.type === CARD_TYPES.NUMBER && c.value === card.value);
        if (duplicate) {
            isBust = true;
        }
    }
    
    currentTurnCards.push(card);
    
    if (card.type === CARD_TYPES.DOUBLE) {
        hasDouble = true;
    }
    if (card.type === CARD_TYPES.HEART) {
        hasHeart = true;
    }
    
    isProcessingAction = true;
    sendGameState();

    // Gestione della carta speciale PESCA TRE (Three Strikes)
    if (card.type === CARD_TYPES.THREE_STRIKES) {
        setTimeout(() => {
            const shooter = players[activePlayerIndex];
            // I bersagli validi qui includono anche i "banked" (quelli fermati volontariamente), ma escludono solo chi è sballato (busted)
            const eligibleTargets = players.filter(p => p.id !== shooter.id && !p.busted);
            
            if (eligibleTargets.length === 0) {
                alert("Non ci sono altri giocatori validi a cui assegnare la carta! Viene scartata.");
                isProcessingAction = false;
                currentTurnCards.pop();
                sendGameState();
            } else {
                sendGameState(shooter.id, eligibleTargets.map(t => ({ id: t.id, name: t.name })));
            }
        }, 1500);
        return;
    }

    // Gestione carte normali, Freeze o Sballo
    if (isBust || card.type === CARD_TYPES.FREEZE) {
        setTimeout(() => {
            isProcessingAction = false;
            
            if (isBust) {
                if (hasHeart) {
                    hasHeart = false;
                    const heartIdx = currentTurnCards.findIndex(c => c.type === CARD_TYPES.HEART);
                    if (heartIdx > -1) currentTurnCards.splice(heartIdx, 1);
                    alert("Sballato! Ma la carta Cuore ti ha salvato la vita!");
                    // Passa il turno dopo il salvataggio
                    nextTurn();
                } else {
                    players[activePlayerIndex].busted = true;
                    alert("Sballato (Bust)! Fai 0 punti in questo turno.");
                    // Nota: NON azzeriamo currentTurnCards qui perché appartiene a tutto il round/tavolo.
                    // Chi sballa è fuori dai giochi, ma le carte rimangono sul tavolo.
                    nextTurn();
                }
            } else if (card.type === CARD_TYPES.FREEZE) {
                alert("Hai pescato un Freeze! Il tuo turno termina con successo (vieni congelato/fermato).");
                handleStopAction();
            }
        }, 1500);
    } else {
        // Nessuno sballo e nessuna azione speciale: passa direttamente il turno al prossimo giocatore
        setTimeout(() => {
            isProcessingAction = false;
            nextTurn();
        }, 1000);
    }
}

function executeThreeStrikesAssignment(targetId) {
    const targetPlayer = players.find(p => p.id === targetId);
    const shooterPlayer = players[activePlayerIndex];
    
    if (!targetPlayer) return;
    
    currentTurnCards = currentTurnCards.filter(c => c.type !== CARD_TYPES.THREE_STRIKES);
    
    broadcast({ 
        type: 'ALERT', 
        message: `${shooterPlayer.name} ha lanciato una carta "PESCA 3" su ${targetPlayer.name}!` 
    });
    alert(`${shooterPlayer.name} ha lanciato una carta "PESCA 3" su ${targetPlayer.name}!`);

    const originalActiveIndex = activePlayerIndex;
    activePlayerIndex = players.indexOf(targetPlayer);
    
    let strikesDrawn = 0;
    isProcessingAction = true;

    function drawStrike() {
        if (strikesDrawn < 3) {
            if (deck.length === 0) deck = createDeck();
            const card = deck.pop();
            
            let isBust = false;
            if (card.type === CARD_TYPES.NUMBER) {
                const duplicate = currentTurnCards.find(c => c.type === CARD_TYPES.NUMBER && c.value === card.value);
                if (duplicate) isBust = true;
            }
            
            currentTurnCards.push(card);
            sendGameState();
            
            setTimeout(() => {
                if (isBust) {
                    if (hasHeart) {
                        hasHeart = false;
                        const heartIdx = currentTurnCards.findIndex(c => c.type === CARD_TYPES.HEART);
                        if (heartIdx > -1) currentTurnCards.splice(heartIdx, 1);
                        alert(`Carta ${strikesDrawn + 1} svelata. Sballato, ma salvato dal Cuore!`);
                        strikesDrawn++;
                        drawStrike();
                    } else {
                        targetPlayer.busted = true;
                        alert(`${targetPlayer.name} ha sballato durante il "Pesca 3" e non farà punti in questo round!`);
                        activePlayerIndex = originalActiveIndex;
                        isProcessingAction = false;
                        nextTurn();
                    }
                } else {
                    strikesDrawn++;
                    drawStrike();
                }
            }, 1200);
        } else {
            alert(`${targetPlayer.name} è sopravvissuto brillantemente al "Pesca 3"!`);
            activePlayerIndex = originalActiveIndex;
            isProcessingAction = false;
            nextTurn();
        }
    }

    drawStrike();
}

function playerStop() {
    if (isProcessingAction) return;

    if (isHost) {
        handleStopAction();
    } else {
        conn.send({ type: 'ACTION_STOP' });
    }
}

function handleStopAction() {
    let turnScore = 0;
    const numberCards = currentTurnCards.filter(c => c.type === CARD_TYPES.NUMBER);
    
    numberCards.forEach(c => {
        turnScore += c.value;
    });
    
    if (numberCards.length >= 7) {
        turnScore += 15;
        alert(`Bonus Flip 7! Avete collezionato ${numberCards.length} carte numeriche diverse: +15 punti bonus!`);
    }
    
    if (hasDouble) {
        turnScore *= 2;
    }
    
    // Assegna il punteggio corrente al giocatore che si ferma volontariamente
    players[activePlayerIndex].score += turnScore;
    players[activePlayerIndex].banked = true;
    
    if (players[activePlayerIndex].score >= 200) {
        broadcast({ 
            type: 'GAME_OVER', 
            winnerName: players[activePlayerIndex].name, 
            score: players[activePlayerIndex].score 
        });
        
        alert(`Fine Partita!\n\nIl giocatore ${players[activePlayerIndex].name} ha vinto con ${players[activePlayerIndex].score} punti!`);
        resetWholeGame();
        return;
    }
    
    nextTurn();
}

function resetWholeGame() {
    if (!isHost) return;
    
    players.forEach(p => {
        p.score = 0;
        p.busted = false;
        p.banked = false;
    });
    deck = createDeck();
    activePlayerIndex = 0;
    currentTurnCards = [];
    hasDouble = false;
    hasHeart = false;
    isProcessingAction = false;
    
    sendGameState();
}

function nextTurn() {
    // Controlla se TUTTI i giocatori del round sono sballati o si sono fermati volontariamente (banked)
    if (players.every(p => p.busted || p.banked)) {
        alert("Il round è terminato! Tutte le carte accumulate sul tavolo vengono rimosse per il prossimo round.");
        players.forEach(p => {
            p.busted = false;
            p.banked = false;
        });
        currentTurnCards = [];
        hasDouble = false;
        hasHeart = false;
        activePlayerIndex = 0;
        sendGameState();
        return;
    }

    // Trova il prossimo giocatore attivo (non sballato e non banked)
    let attempts = 0;
    do {
        activePlayerIndex = (activePlayerIndex + 1) % players.length;
        attempts++;
    } while ((players[activePlayerIndex].busted || players[activePlayerIndex].banked) && attempts < players.length);
    
    sendGameState();
}