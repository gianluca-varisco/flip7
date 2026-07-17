// Configurazione e Stato Globale
let peer = null;
let conn = null; // Usato dal Client per comunicare con l'Host
let connections = []; // Lista di tutte le connessioni attive (usato dall'Host)
let isHost = false;
let myPeerId = "";
let myNickname = "";
let inviteRoomId = "";

// Stato del Gioco
let players = []; // { id, name, score, active, busted, banked, cards: [], hasDouble, hasHeart }
let activePlayerIndex = 0;
let deck = [];
let isGameOver = false;
let isProcessingAction = false; // Evita clic multipli durante le animazioni temporizzate

// Configurazione mazzo Flip 7 standard + Carta Pesca 3
const CARD_TYPES = {
    NUMBER: 'number',
    FREEZE: 'freeze',
    DOUBLE: 'double',
    HEART: 'heart',
    THREE_STRIKES: 'three_strikes' // Carta speciale
};

// Controllo all'avvio
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    
    // Controlla se l'host sta tornando dopo aver condiviso il link
    const savedHostRoom = sessionStorage.getItem('host_room_id');
    const savedHostNick = sessionStorage.getItem('host_nickname');

    if (savedHostRoom && savedHostNick && !room) {
        // Ripristina la sessione dell'Host che torna da WhatsApp
        document.getElementById('join-group').style.display = 'none';
        document.getElementById('lobby-divider').style.display = 'none';
        document.getElementById('btn-host').disabled = true;
        
        myNickname = savedHostNick;
        inviteRoomId = savedHostRoom;
        isHost = true;
        
        reconnectHost(savedHostRoom);
    } else if (room) {
        // È un client invitato
        document.getElementById('join-id').value = room.toUpperCase();
        document.getElementById('btn-host').style.display = 'none';
        document.getElementById('lobby-divider').style.display = 'none';
        document.getElementById('host-id-display').innerText = "Stai entrando nella stanza: " + room.toUpperCase();
    }
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
    for (let i = 1; i <= 12; i++) {
        for (let j = 0; j < i; j++) {
            newDeck.push({ type: CARD_TYPES.NUMBER, value: i });
        }
    }
    for (let i = 0; i < 4; i++) newDeck.push({ type: CARD_TYPES.FREEZE, value: 'FREEZE' });
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.DOUBLE, value: 'x2' });
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.HEART, value: '♥' });
    for (let i = 0; i < 3; i++) newDeck.push({ type: CARD_TYPES.THREE_STRIKES, value: '👉 3' });
    
    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    return newDeck;
}

// --- LOGICA DI RETE (PEERJS) ---

function initPeer(customId, callback) {
    if (peer) {
        try { peer.destroy(); } catch(e) {}
    }

    peer = new Peer(customId, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        pingInterval: 3000,
        config: {
            // Forziamo l'uso esclusivo del relay (TURN) per evitare che Wind e il router di casa si blocchino a vicenda
            'iceTransportPolicy': 'relay', 
            'iceServers': [
                // Server TURN gratuiti dall'Open Relay Project
                {
                    'urls': 'turn:openrelay.metered.ca:443',
                    'username': 'openrelayproject',
                    'credential': 'openrelayproject'
                },
                {
                    'urls': 'turn:openrelay.metered.ca:80',
                    'username': 'openrelayproject',
                    'credential': 'openrelayproject'
                }
            ]
        }
    });
    
    peer.on('open', (id) => {
        myPeerId = id;
        callback(id);
    });

    peer.on('disconnected', () => {
        console.log("Scollegato dal server. Riconnessione...");
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error("Errore PeerJS:", err);
        
        if (err.type === 'unavailable-id') {
            if (isHost) {
                console.log("ID occupato dal vecchio processo. Tentativo di riconnessione tra 3 secondi...");
                setTimeout(() => {
                    reconnectHost(customId);
                }, 3000);
            } else {
                alert("La stanza è temporaneamente occupata. Riprova tra pochi secondi.");
            }
        }
    });
}

function startHost() {
    myNickname = prompt("Inserisci il tuo Nickname:") || "Host";
    const shortId = generateShortId();
    inviteRoomId = shortId;
    isHost = true;
    
    // Salva i dati in sessione per recuperarli quando torni da WhatsApp
    sessionStorage.setItem('host_room_id', shortId);
    sessionStorage.setItem('host_nickname', myNickname);
    
    reconnectHost(shortId);
}

function reconnectHost(shortId) {
    initPeer(shortId, (id) => {
        document.getElementById('host-id-display').innerText = "ID Partita: " + id;
        document.getElementById('btn-host').disabled = true;
        document.getElementById('btn-join').disabled = true;
        document.getElementById('join-id').disabled = true;
        document.getElementById('btn-copy-link').style.display = 'inline-block';
        
        // Se la lista giocatori è vuota (prima creazione), inserisci l'Host
        if (players.length === 0) {
            players = [{ id: id, name: myNickname, score: 0, active: true, busted: false, banked: false, cards: [], hasDouble: false, hasHeart: false }];
        } else {
            // Aggiorna l'ID dell'host se è cambiato durante il ripristino
            players[0].id = id;
        }
        
        updatePlayerListUI();
        document.getElementById('player-list-container').style.display = 'block';
        document.getElementById('btn-start-game').style.display = 'inline-block';
        
        peer.on('connection', (connection) => {
            // Rileva duplicati prima di aggiungere la connessione
            connections = connections.filter(c => c.peer !== connection.peer);
            connections.push(connection);
            setupHostConnection(connection);
        });
    });
}

function copyInviteLink() {
    if (!inviteRoomId) return;
    const inviteUrl = window.location.origin + window.location.pathname + "?room=" + inviteRoomId;
    navigator.clipboard.writeText(inviteUrl).then(() => {
        const btn = document.getElementById('btn-copy-link');
        btn.innerText = "✅ Link Copiato!";
        setTimeout(() => {
            btn.innerText = "🔗 Copia Link di Invito";
        }, 2000);
    }).catch(err => {
        alert("Copia questo link e invialo: " + inviteUrl);
    });
}

function setupHostConnection(connection) {
    connection.on('data', (data) => {
        if (data.type === 'SEND_NICKNAME') {
            // Controlla se il giocatore esiste già (es. si era disconnesso temporaneamente)
            const playerIndex = players.findIndex(p => p.id === connection.peer);
            if (playerIndex === -1) {
                players.push({ 
                    id: connection.peer, 
                    name: data.nickname, 
                    score: 0, 
                    active: true, 
                    busted: false, 
                    banked: false, 
                    cards: [], 
                    hasDouble: false, 
                    hasHeart: false 
                });
            } else {
                // Aggiorna il nickname se necessario
                players[playerIndex].name = data.nickname;
            }
            
            // Aggiorna l'interfaccia dell'Host in tempo reale
            updatePlayerListUI();
            
            // Invia la lista aggiornata a tutti i client connessi
            broadcast({ type: 'UPDATE_PLAYERS', players: players });
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
            // Inviamo immediatamente il nickname all'apertura del tunnel
            conn.send({ type: 'SEND_NICKNAME', nickname: myNickname });
            
            document.getElementById('lobby').style.display = 'none';
            document.getElementById('table').style.display = 'block';
            document.getElementById('turn-indicator').innerText = "Connesso! In attesa che l'host avvii la partita...";
        });
        
        conn.on('data', (data) => {
            if (data.type === 'UPDATE_PLAYERS') {
                players = data.players;
                updateScoresUI();
                updatePlayerListUI();
            }
            if (data.type === 'START_GAME_CLIENT') {
                document.getElementById('lobby').style.display = 'none';
                document.getElementById('table').style.display = 'block';
            }
            if (data.type === 'UPDATE_STATE') {
                players = data.players;
                activePlayerIndex = data.activePlayerIndex;
                isProcessingAction = data.isProcessingAction || false;
                updateScoresUI();
                renderAllPlayersCards();
                updateTurnControls();
                
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
            alert("Connessione con l'Host interrotta. Tentativo di riconnessione...");
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

function getCardHTML(card, isMini = false) {
    let classes = 'card';
    if (isMini) classes += ' mini-card';
    if (card.type === CARD_TYPES.FREEZE) classes += ' special-freeze';
    if (card.type === CARD_TYPES.DOUBLE) classes += ' special-double';
    if (card.type === CARD_TYPES.HEART) classes += ' special-heart';
    if (card.type === CARD_TYPES.THREE_STRIKES) classes += ' special-heart';
    
    if (isMini) {
        return `<div class="${classes}"><div class="card-value">${card.value}</div></div>`;
    }
    return `
        <div class="${classes}">
            <div class="card-corner">${card.value}</div>
            <div class="card-value">${card.value}</div>
            <div class="card-corner bottom">${card.value}</div>
        </div>
    `;
}

function renderAllPlayersCards() {
    const myRowContainer = document.getElementById('current-row');
    const opponentsContainer = document.getElementById('opponents-row');
    
    if (!myRowContainer || !opponentsContainer) return;
    
    myRowContainer.innerHTML = "";
    opponentsContainer.innerHTML = "";
    
    const me = players.find(p => p.id === myPeerId);
    
    if (me && me.cards && me.cards.length > 0) {
        me.cards.forEach(card => {
            myRowContainer.innerHTML += getCardHTML(card, false);
        });
    } else {
        myRowContainer.innerHTML = `<div style="font-style: italic; color: #aaa;">Nessuna carta pescata in questo round</div>`;
    }
    
    players.forEach(p => {
        if (p.id !== myPeerId) {
            const oppDiv = document.createElement('div');
            oppDiv.className = 'opponent-box';
            if (p.busted) oppDiv.classList.add('opp-busted');
            if (p.banked) oppDiv.classList.add('opp-banked');
            
            let statusText = "";
            if (p.busted) statusText = " (SBALLATO)";
            if (p.banked) statusText = " (FERMO)";
            
            let cardsHTML = "";
            if (p.cards && p.cards.length > 0) {
                p.cards.forEach(card => {
                    cardsHTML += getCardHTML(card, true);
                });
            } else {
                cardsHTML = `<div style="font-style: italic; color: #888; font-size: 12px;">Nessuna carta pescata</div>`;
            }
            
            oppDiv.innerHTML = `
                <h4>${p.name}${statusText}</h4>
                <div class="opponent-cards-row">${cardsHTML}</div>
            `;
            opponentsContainer.appendChild(oppDiv);
        }
    });
}

function updateTurnControls() {
    const isMyTurn = (players[activePlayerIndex] && players[activePlayerIndex].id === myPeerId);
    const me = players.find(p => p.id === myPeerId);
    
    document.getElementById('btn-flip').disabled = !isMyTurn || isProcessingAction;
    document.getElementById('btn-stop').disabled = !isMyTurn || !me || me.cards.length === 0 || isProcessingAction;
    
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

// Chiudi selezione
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
    
    // Rimuovi lo stato "salvato" dal browser: la partita è iniziata ufficialmente
    sessionStorage.removeItem('host_room_id');
    sessionStorage.removeItem('host_nickname');
    
    deck = createDeck();
    activePlayerIndex = 0;
    isProcessingAction = false;
    
    players.forEach(p => {
        p.score = 0;
        p.busted = false;
        p.banked = false;
        p.cards = [];
        p.hasDouble = false;
        p.hasHeart = false;
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
        isProcessingAction: isProcessingAction,
        showTargetSelectionFor: customTargetId,
        eligibleTargets: eligibleTargets
    };
    
    if (isHost) {
        updateScoresUI();
        renderAllPlayersCards();
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
    const activePlayer = players[activePlayerIndex];
    
    if (card.type === CARD_TYPES.NUMBER) {
        const duplicate = activePlayer.cards.find(c => c.type === CARD_TYPES.NUMBER && c.value === card.value);
        if (duplicate) {
            isBust = true;
        }
    }
    
    activePlayer.cards.push(card);
    
    if (card.type === CARD_TYPES.DOUBLE) activePlayer.hasDouble = true;
    if (card.type === CARD_TYPES.HEART) activePlayer.hasHeart = true;
    
    isProcessingAction = true;
    sendGameState();

    if (card.type === CARD_TYPES.THREE_STRIKES) {
        setTimeout(() => {
            const shooter = players[activePlayerIndex];
            const eligibleTargets = players.filter(p => p.id !== shooter.id && !p.busted);
            
            if (eligibleTargets.length === 0) {
                alert("Non ci sono altri giocatori validi a cui assegnare la carta! Viene scartata.");
                isProcessingAction = false;
                activePlayer.cards.pop();
                sendGameState();
            } else {
                sendGameState(shooter.id, eligibleTargets.map(t => ({ id: t.id, name: t.name })));
            }
        }, 1500);
        return;
    }

    if (isBust || card.type === CARD_TYPES.FREEZE) {
        setTimeout(() => {
            isProcessingAction = false;
            
            if (isBust) {
                if (activePlayer.hasHeart) {
                    activePlayer.hasHeart = false;
                    const heartIdx = activePlayer.cards.findIndex(c => c.type === CARD_TYPES.HEART);
                    if (heartIdx > -1) activePlayer.cards.splice(heartIdx, 1);
                    alert("Sballato! Ma la carta Cuore ti ha salvato la vita!");
                    nextTurn();
                } else {
                    activePlayer.busted = true;
                    activePlayer.cards = [];
                    activePlayer.hasDouble = false;
                    activePlayer.hasHeart = false;
                    alert(`${activePlayer.name} ha sballato (Bust)!`);
                    nextTurn();
                }
            } else if (card.type === CARD_TYPES.FREEZE) {
                alert("Hai pescato un Freeze! Il tuo turno termina con successo.");
                handleStopAction();
            }
        }, 1500);
    } else {
        setTimeout(() => {
            isProcessingAction = false;
            nextTurn();
        }, 1200);
    }
}

function executeThreeStrikesAssignment(targetId) {
    const targetPlayer = players.find(p => p.id === targetId);
    const shooterPlayer = players[activePlayerIndex];
    
    if (!targetPlayer) return;
    
    shooterPlayer.cards = shooterPlayer.cards.filter(c => c.type !== CARD_TYPES.THREE_STRIKES);
    
    broadcast({ 
        type: 'ALERT', 
        message: `${shooterPlayer.name} ha lanciato una carta "PESCA 3" su ${targetPlayer.name}!` 
    });
    alert(`${shooterPlayer.name} ha lanciato una carta "PESCA 3" su ${targetPlayer.name}!`);

    const originalActiveIndex = activePlayerIndex;
    activePlayerIndex = players.indexOf(targetPlayer);
    
    let strikesDrawn = 0;
    isProcessingAction = true;
    sendGameState();

    function drawStrike() {
        if (strikesDrawn < 3) {
            if (deck.length === 0) deck = createDeck();
            const card = deck.pop();
            
            let isBust = false;
            if (card.type === CARD_TYPES.NUMBER) {
                const duplicate = targetPlayer.cards.find(c => c.type === CARD_TYPES.NUMBER && c.value === card.value);
                if (duplicate) isBust = true;
            }
            
            targetPlayer.cards.push(card);
            if (card.type === CARD_TYPES.DOUBLE) targetPlayer.hasDouble = true;
            if (card.type === CARD_TYPES.HEART) targetPlayer.hasHeart = true;
            
            sendGameState();
            
            setTimeout(() => {
                if (isBust) {
                    if (targetPlayer.hasHeart) {
                        targetPlayer.hasHeart = false;
                        const heartIdx = targetPlayer.cards.findIndex(c => c.type === CARD_TYPES.HEART);
                        if (heartIdx > -1) targetPlayer.cards.splice(heartIdx, 1);
                        alert(`Carta ${strikesDrawn + 1} svelata. Sballato, ma salvato dal Cuore!`);
                        strikesDrawn++;
                        drawStrike();
                    } else {
                        targetPlayer.busted = true;
                        targetPlayer.cards = [];
                        targetPlayer.hasDouble = false;
                        targetPlayer.hasHeart = false;
                        alert(`${targetPlayer.name} ha sballato a causa del "Pesca 3"!`);
                        
                        isProcessingAction = false;
                        activePlayerIndex = originalActiveIndex;
                        nextTurn();
                    }
                } else {
                    strikesDrawn++;
                    drawStrike();
                }
            }, 1200);
        } else {
            alert(`${targetPlayer.name} è sopravvissuto al "Pesca 3"!`);
            isProcessingAction = false;
            activePlayerIndex = originalActiveIndex;
            nextTurn();
        }
    }

    setTimeout(drawStrike, 800);
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
    const activePlayer = players[activePlayerIndex];
    let turnScore = 0;
    const numberCards = activePlayer.cards.filter(c => c.type === CARD_TYPES.NUMBER);
    
    numberCards.forEach(c => {
        turnScore += c.value;
    });
    
    if (numberCards.length >= 7) {
        turnScore += 15;
        alert(`Bonus Flip 7! Hai collezionato ${numberCards.length} carte numeriche diverse: +15 punti bonus!`);
    }
    
    if (activePlayer.hasDouble) {
        turnScore *= 2;
    }
    
    activePlayer.score += turnScore;
    activePlayer.banked = true;
    
    if (activePlayer.score >= 200) {
        broadcast({ 
            type: 'GAME_OVER', 
            winnerName: activePlayer.name, 
            score: activePlayer.score 
        });
        
        alert(`Fine Partita!\n\nIl giocatore ${activePlayer.name} ha vinto con ${activePlayer.score} punti!`);
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
        p.cards = [];
        p.hasDouble = false;
        p.hasHeart = false;
    });
    deck = createDeck();
    activePlayerIndex = 0;
    isProcessingAction = false;
    
    sendGameState();
}

function nextTurn() {
    if (players.every(p => p.busted || p.banked)) {
        alert("Il round è terminato! Le carte vengono resettate per il prossimo round.");
        players.forEach(p => {
            p.busted = false;
            p.banked = false;
            p.cards = [];
            p.hasDouble = false;
            p.hasHeart = false;
        });
        activePlayerIndex = 0;
        sendGameState();
        return;
    }

    let attempts = 0;
    do {
        activePlayerIndex = (activePlayerIndex + 1) % players.length;
        attempts++;
    } while ((players[activePlayerIndex].busted || players[activePlayerIndex].banked) && attempts < players.length);
    
    sendGameState();
}