/* HEZ MAAK - Area Pro (trasportatori), messaggi admin a tutti. Caricato dopo app.js */
(function () {
  const sb = supabaseClient, esc = escapeHtml;
  const PRICE = "13,50";
  const STATUS = { to_collect: "Da ritirare", collected: "Ritirato", in_transit: "In viaggio", delivered: "Consegnato" };
  const eur = n => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  const $ = id => document.getElementById(id);
  let ships = [], tab = "ships";

  /* ---- Pulsante "Area Pro" nell'header (solo trasportatori/aziende) ---- */
  async function ensureProButton() {
    const old = $("proHeaderButton");
    if (!currentUser) { if (old) old.remove(); return; }
    if (old) return;
    const { data } = await sb.from("profiles").select("user_type").eq("id", currentUser.id).maybeSingle();
    if (!data || !["carrier", "company"].includes(data.user_type) || $("proHeaderButton")) return;
    const b = document.createElement("button");
    b.id = "proHeaderButton"; b.type = "button"; b.className = "pro-header-button"; b.textContent = "🧰 Area Pro";
    b.onclick = openPro;
    $("mainNav").appendChild(b);
  }
  const _updateHeader = updateHeader;
  updateHeader = function () { _updateHeader(); ensureProButton(); };

  /* ---- Pagina Pro ---- */
  function page(html) {
    let p = $("proPage");
    if (!p) { p = document.createElement("div"); p.id = "proPage"; document.body.appendChild(p); }
    p.innerHTML = `<div class="pro-wrap">${html}</div>`;
  }
  window.closePro = () => { const p = $("proPage"); if (p) p.remove(); };

  window.openPro = async function () {
    if (!currentUser) return openAuth("login");
    const { data, error } = await sb.rpc("pro_status");
    if (error) return alert(error.message);
    const s = data && data[0];
    if (!s || !s.has_row) return paywall("start");
    if (!s.has_access) return paywall("expired");
    renderDashboard(s);
  };

  function paywall(mode) {
    const base = typeof STRIPE_PAYMENT_LINK !== "undefined" ? STRIPE_PAYMENT_LINK : "";
    const link = base
      ? base + (base.includes("?") ? "&" : "?") + "client_reference_id=" + currentUser.id
      : "";
    const start = mode === "start";
    page(`<div class="pro-top"><h2>Area Pro per trasportatori</h2><button class="secondary" onclick="closePro()">Chiudi</button></div>
      <div class="pro-box">
        <p>Gestisci spedizioni, clienti, partenze e incassi in un solo posto.</p>
        <div class="pro-price">${PRICE} €<small style="font-size:15px;font-weight:400"> / mese</small></div>
        <p>${start ? "Il primo mese è gratis, senza carta. Dopo 30 giorni scegli se continuare." : "La prova è terminata o l'abbonamento è scaduto. I tuoi dati sono al sicuro e tornano disponibili appena riattivi."}</p>
        ${start
          ? `<button class="primary large" onclick="startProTrial()">Inizia il mese gratis</button>`
          : link ? `<a class="primary large" style="display:inline-block;text-decoration:none;text-align:center" href="${esc(link)}" target="_blank" rel="noopener">Abbonati a ${PRICE} €/mese</a>`
                 : `<p><strong>Pagamento non ancora configurato.</strong> Imposta STRIPE_PAYMENT_LINK in config.js.</p>`}
      </div>`);
  }
  window.startProTrial = async function () {
    const { error } = await sb.rpc("start_pro_trial");
    if (error) return alert(error.message);
    openPro();
  };

  async function renderDashboard(s) {
    const end = s.status === "trialing" ? new Date(s.trial_ends_at) : new Date(s.current_period_end);
    const days = Math.max(0, Math.ceil((end - Date.now()) / 864e5));
    const badge = s.status === "trialing"
      ? `<span class="pro-badge ${days <= 5 ? "warn" : ""}">Prova gratuita: ${days} giorni rimasti</span>`
      : `<span class="pro-badge">Abbonamento attivo</span>`;
    page(`<div class="pro-top"><h2>Area Pro</h2><div>${badge} <button class="secondary" onclick="closePro()">Chiudi</button></div></div>
      <div class="pro-tabs">${[["ships", "📦 Spedizioni"], ["trips", "✈️ Partenze"], ["money", "💶 Guadagni"]]
        .map(([k, l]) => `<button class="${tab === k ? "on" : ""}" onclick="proTab('${k}')">${l}</button>`).join("")}</div>
      <div id="proBody">Caricamento...</div>`);
    const { data, error } = await sb.from("pro_shipments").select("*").order("created_at", { ascending: false });
    if (error) return ($("proBody").textContent = error.message);
    ships = data || [];
    drawTab();
  }
  window.proTab = k => { tab = k; openPro(); };

  function drawTab() {
    const el = $("proBody");
    if (tab === "ships") el.innerHTML = shipForm() + `<div class="pro-box">${ships.length ? ships.map(shipRow).join("") : "Nessuna spedizione. Aggiungi la prima qui sopra."}</div>`;
    else if (tab === "trips") el.innerHTML = trips();
    else el.innerHTML = money();
  }

  const shipForm = () => `<div class="pro-box"><strong>Nuova spedizione</strong><div class="pro-grid" style="margin-top:10px">
    <input id="psName" placeholder="Cliente *"><input id="psPhone" placeholder="Telefono (con prefisso)">
    <input id="psFrom" placeholder="Da (città)"><input id="psTo" placeholder="A (città)">
    <input id="psKg" type="number" min="0" step="0.1" placeholder="Kg"><input id="psPrice" type="number" min="0" step="0.5" placeholder="Prezzo €">
    <input id="psDate" type="date"><input id="psDesc" placeholder="Cosa trasporti"></div>
    <button class="primary" style="margin-top:10px" onclick="addShipment()">Aggiungi</button></div>`;

  window.addShipment = async function () {
    const name = $("psName").value.trim();
    if (!name) return alert("Inserisci il nome del cliente.");
    const { error } = await sb.from("pro_shipments").insert({
      client_name: name, client_phone: $("psPhone").value.trim() || null, origin: $("psFrom").value.trim(),
      destination: $("psTo").value.trim(), weight_kg: parseFloat($("psKg").value) || 0, price: parseFloat($("psPrice").value) || 0,
      trip_date: $("psDate").value || null, description: $("psDesc").value.trim()
    });
    if (error) return alert(error.message);
    openPro();
  };

  const shipRow = x => {
    const wa = x.client_phone ? `<a href="https://wa.me/${esc(x.client_phone.replace(/\D/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>` : "";
    return `<div class="pro-row"><div><strong>${esc(x.client_name)}</strong> ${wa}<br>
      <small>${esc(x.origin || "?")} → ${esc(x.destination || "?")} · ${x.weight_kg || 0} kg · ${eur(x.price)}${x.trip_date ? " · " + esc(x.trip_date) : ""}</small>
      ${x.description ? `<br><small>${esc(x.description)}</small>` : ""}</div>
      <div><select onchange="setShip('${x.id}',{status:this.value})">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${x.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label><input type="checkbox" style="width:auto" ${x.paid ? "checked" : ""} onchange="setShip('${x.id}',{paid:this.checked})"> Pagato</label>
      <button class="secondary" onclick="delShip('${x.id}')">Elimina</button></div></div>`;
  };
  window.setShip = async (id, patch) => { const { error } = await sb.from("pro_shipments").update(patch).eq("id", id); if (error) alert(error.message); else { Object.assign(ships.find(s => s.id === id), patch); if (tab !== "ships") drawTab(); } };
  window.delShip = async id => { if (!confirm("Eliminare questa spedizione?")) return; await sb.from("pro_shipments").delete().eq("id", id); openPro(); };

  function trips() {
    const g = {};
    ships.filter(x => x.status !== "delivered").forEach(x => { const k = x.trip_date || "Senza data"; (g[k] = g[k] || []).push(x); });
    const keys = Object.keys(g).sort();
    return keys.length ? keys.map(k => `<div class="pro-box"><strong>${esc(k)}</strong>
      <p>${g[k].length} spedizioni · ${g[k].reduce((a, x) => a + Number(x.weight_kg || 0), 0)} kg · ${eur(g[k].reduce((a, x) => a + Number(x.price || 0), 0))}</p>
      ${g[k].map(x => `<div class="pro-row"><span>${esc(x.client_name)} (${esc(x.destination || "?")})</span><span>${x.weight_kg || 0} kg · ${STATUS[x.status]}</span></div>`).join("")}</div>`).join("")
      : `<div class="pro-box">Nessuna partenza in programma. Assegna una data alle spedizioni per vederle raggruppate.</div>`;
  }

  function money() {
    const m = new Date().toISOString().slice(0, 7), mine = ships.filter(x => (x.trip_date || x.created_at).slice(0, 7) === m);
    const sum = (a, f) => a.filter(f).reduce((t, x) => t + Number(x.price || 0), 0);
    const open = sum(ships, x => !x.paid);
    const months = {}; ships.filter(x => x.paid).forEach(x => { const k = (x.trip_date || x.created_at).slice(0, 7); months[k] = (months[k] || 0) + Number(x.price || 0); });
    return `<div class="pro-grid"><div class="pro-box pro-stat">${eur(sum(mine, x => x.paid))}<small>Incassato questo mese</small></div>
      <div class="pro-box pro-stat">${eur(open)}<small>Ancora da incassare</small></div>
      <div class="pro-box pro-stat">${ships.filter(x => x.status === "delivered").length}<small>Consegne completate</small></div></div>
      <div class="pro-box"><strong>Incassi per mese</strong>${Object.keys(months).sort().reverse().slice(0, 12).map(k => `<div class="pro-row"><span>${k}</span><strong>${eur(months[k])}</strong></div>`).join("") || "<p>Ancora nessun incasso registrato.</p>"}</div>`;
  }

  /* ---- Admin: messaggio a tutti ---- */
  const _loadAdminPanel = loadAdminPanel;
  loadAdminPanel = async function () {
    await _loadAdminPanel.apply(this, arguments);
    const pg = $("adminPage");
    if (!pg || $("adminBroadcast")) return;
    const box = document.createElement("div");
    box.id = "adminBroadcast"; box.className = "pro-box admin-broadcast";
    box.innerHTML = `<strong>📣 Scrivi a tutti gli utenti</strong>
      <select id="bcAud" style="margin:10px 0"><option value="all">Tutti gli iscritti</option><option value="pro">Solo trasportatori e aziende</option></select>
      <input id="bcTitle" maxlength="120" placeholder="Titolo" style="margin-bottom:8px">
      <textarea id="bcMsg" rows="3" maxlength="1000" placeholder="Messaggio"></textarea>
      <button class="primary" style="margin-top:10px" onclick="sendBroadcast()">Invia notifica</button>`;
    pg.insertBefore(box, pg.firstChild);
  };
  window.sendBroadcast = async function () {
    const title = $("bcTitle").value.trim(), msg = $("bcMsg").value.trim();
    if (!title || !msg) return alert("Inserisci titolo e messaggio.");
    if (!confirm("Inviare a tutti i destinatari selezionati?")) return;
    const { data, error } = await sb.rpc("admin_broadcast", { p_title: title, p_message: msg, p_audience: $("bcAud").value });
    if (error) return alert(error.message);
    alert("Inviato a " + data + " utenti.");
    $("bcTitle").value = $("bcMsg").value = "";
  };

  ensureProButton();
})();
