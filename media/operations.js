(() => {
  const vscode = acquireVsCodeApi();
  const hint = document.getElementById('hint');
  const presetsLabel = document.getElementById('presets-label');
  const presetSelect = document.getElementById('preset-select');
  const unsaved = document.getElementById('unsaved');
  const saveButton = document.getElementById('preset-save');
  const saveAsButton = document.getElementById('preset-save-as');
  const renameButton = document.getElementById('preset-rename');
  const deleteButton = document.getElementById('preset-delete');
  const list = document.getElementById('list');
  const status = document.getElementById('status');
  const run = document.getElementById('run');
  const page = document.querySelector('.page');

  const gripSvg = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.1" fill="currentColor"/><circle cx="10.5" cy="3.5" r="1.1" fill="currentColor"/><circle cx="5.5" cy="8" r="1.1" fill="currentColor"/><circle cx="10.5" cy="8" r="1.1" fill="currentColor"/><circle cx="5.5" cy="12.5" r="1.1" fill="currentColor"/><circle cx="10.5" cy="12.5" r="1.1" fill="currentColor"/></svg>';

  const icons = {
    'cloud-download': '<path d="M8 2.2a3.2 3.2 0 0 0-3.1 2.4 2.6 2.6 0 0 0 .2 5.2h.4v-1.3h-.4a1.3 1.3 0 0 1-.2-2.6l.7-.1.2-.7A2 2 0 0 1 9.7 5a2 2 0 0 1 .3 4h-.5v1.3h.6a2.6 2.6 0 0 0 .2-5.2A3.2 3.2 0 0 0 8 2.2zM7.3 8.2h1.4v3.1l1.2-1.2.9.9L8 13.8 5.2 11l.9-.9 1.2 1.2z"/>',
    'arrow-down': '<path d="M7.2 2h1.6v8.2l2.7-2.7 1.1 1.1L8 13.2 3.4 8.6l1.1-1.1 2.7 2.7z"/>',
    'arrow-up': '<path d="M7.2 14V5.8L4.5 8.5 3.4 7.4 8 2.8l4.6 4.6-1.1 1.1-2.7-2.7V14z"/>',
    add: '<path d="M7.2 2h1.6v4.6H13v1.6H8.8V13H7.2V8.2H2V6.6h5.2z"/>',
    check: '<path d="M6.4 11.2 2.8 7.6l1.1-1.1 2.5 2.5 5.7-5.7 1.1 1.1z"/>',
    sync: '<path d="M12.6 6.2A4.6 4.6 0 0 0 3.8 5.2L2.6 4.1 2 7.4l3.3-.4-1.1-1A3.2 3.2 0 0 1 11.4 7l1.2-.8zM3.4 9.8a4.6 4.6 0 0 0 8.8 1l1.2 1.1.6-3.3-3.3.4 1.1 1a3.2 3.2 0 0 1-6.9-1.1z"/>',
    'cloud-upload': '<path d="M8 2.2a3.2 3.2 0 0 0-3.1 2.4 2.6 2.6 0 0 0 .2 5.2h.4V8.5h-.4a1.3 1.3 0 0 1-.2-2.6l.7-.1.2-.7A2 2 0 0 1 9.7 5a2 2 0 0 1 .3 4h-.5v1.3h.6a2.6 2.6 0 0 0 .2-5.2A3.2 3.2 0 0 0 8 2.2zM8.7 13.8V10.7l1.2 1.2.9-.9L8 8.2 5.2 11l.9.9 1.2-1.2v3.1z"/>',
    archive: '<path d="M2 3.2h12v2.2H2zm1.1 3.2h9.8V13H3.1zm2.2 1.6v1.3h5.4V8z"/>',
    'git-branch': '<path d="M5 2.2a1.7 1.7 0 0 0-.7 3.2v5.2a1.7 1.7 0 1 0 1.4 0V8.4c.8.5 1.6.8 2.5.8h.8a1.7 1.7 0 1 0 0-1.4h-.8c-.7 0-1.4-.2-2-.6V5.4A1.7 1.7 0 0 0 5 2.2zm0 1.2a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1zM11.2 7a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1zM5 11.6a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z"/>',
    'git-merge': '<path d="M5 2.2a1.7 1.7 0 0 0-.7 3.2v1.2A3.4 3.4 0 0 0 7.4 9.6l2.2 1.5v-.7a1.7 1.7 0 1 0-1.4 0v1.6l-2.4-1.6A2 2 0 0 1 4.3 8V5.4A1.7 1.7 0 0 0 5 2.2zm0 1.2a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1zm6.4 6.2a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z"/>',
    'debug-restart': '<path d="M8 3.1 4.6 6.2l1 .9L7.3 5.6V9H8.7V5.6l1.7 1.5 1-1zM3.4 8.2A4.7 4.7 0 0 0 8 13.6a4.7 4.7 0 0 0 4.2-2.6l-1.3-.6A3.3 3.3 0 0 1 8 12.2a3.3 3.3 0 0 1-3.2-2.6z"/>',
    tag: '<path d="M8.6 2.2 2.4 3.1 1.5 9.3l6.2 6.2 7.1-7.1zm-4.2 4a1.2 1.2 0 1 1 1.7-1.7 1.2 1.2 0 0 1-1.7 1.7z"/>',
    'git-pull-request': '<path d="M5 2.2a1.7 1.7 0 0 0-.7 3.2v5.2a1.7 1.7 0 1 0 1.4 0V5.4A1.7 1.7 0 0 0 5 2.2zm6.2 6.2V6.8L9.4 8.6l1.8 1.8V8.8h.6a1.8 1.8 0 0 1 0 3.6h-.8v1.4h.8a3.2 3.2 0 0 0 0-6.4zM5 3.4a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1zm0 8.2a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z"/>',
    discard: '<path d="M3.2 2.6h6l2.8 2.8v8.2H3.2zm1.3 1.3v8.4h6.2V6.1H8.4V3.9zM6 7.7l1-.9.9.9.9-.9 1 .9-.9 1 .9.9-1 .9-.9-.9-.9.9-1-.9.9-.9z"/>',
    'repo-force-push': '<path d="M3 3.2h6.2v1.4H4.4v6.8H3zm4.2 2.2h6.6V13H7.2zm1.4 1.4v4.8h3.8V6.8zM2.2 11.2 5 8.4l.9.9-1.1 1.1H8v1.4H4.8l1.1 1.1-.9.9z"/>',
  };

  let items = [];
  let dragId = '';
  let dropTarget = null;
  let dragLabel = 'Drag to reorder';
  let activePresetId = '';

  run.addEventListener('click', () => vscode.postMessage({ type: 'run' }));
  presetSelect.addEventListener('change', () => {
    if (presetSelect.disabled) {
      return;
    }
    if (!presetSelect.value) {
      presetSelect.value = activePresetId;
      return;
    }
    vscode.postMessage({ type: 'preset', id: presetSelect.value });
  });
  saveButton.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  saveAsButton.addEventListener('click', () => vscode.postMessage({ type: 'saveAs' }));
  renameButton.addEventListener('click', () => vscode.postMessage({ type: 'rename' }));
  deleteButton.addEventListener('click', () => vscode.postMessage({ type: 'delete' }));

  list.addEventListener('dragover', event => {
    event.preventDefault();
    const row = event.target.closest('.op');
    clearMarkers();
    if (!row || row.dataset.id === dragId) {
      const last = list.querySelector('.op:last-child');
      if (last && last.dataset.id !== dragId) {
        last.classList.add('after');
        dropTarget = { id: last.dataset.id, after: true };
      } else {
        dropTarget = null;
      }
      return;
    }
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.add(after ? 'after' : 'before');
    dropTarget = { id: row.dataset.id, after };
  });

  list.addEventListener('drop', event => {
    event.preventDefault();
    if (!dragId || !dropTarget) {
      clearMarkers();
      return;
    }
    const order = moveItem(items.map(item => item.id), dragId, dropTarget.id, dropTarget.after);
    clearMarkers();
    dragId = '';
    vscode.postMessage({ type: 'reorder', order });
  });

  list.addEventListener('dragend', () => {
    dragId = '';
    clearMarkers();
  });

  list.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') {
      return;
    }
    const row = input.closest('.op');
    if (!row) {
      return;
    }
    vscode.postMessage({ type: 'toggle', id: row.dataset.id, enabled: input.checked });
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }
    activePresetId = message.activePresetId || '';
    const labels = message.labels || {};
    items = message.items || [];
    dragLabel = labels.drag || dragLabel;
    hint.textContent = message.hint || '';
    presetsLabel.textContent = labels.presets || '';
    unsaved.textContent = message.unsavedLabel || '';
    status.textContent = message.status || '';
    run.textContent = message.running ? labels.stop : labels.start;
    run.classList.toggle('stop', Boolean(message.running));
    page.classList.toggle('running', Boolean(message.running));
    saveButton.textContent = labels.save || 'Save';
    saveAsButton.textContent = labels.saveAs || 'Save As';
    renameButton.textContent = labels.rename || 'Rename';
    deleteButton.textContent = labels.delete || 'Delete';
    const locked = Boolean(message.running);
    presetSelect.disabled = locked;
    saveButton.disabled = locked || !message.canSave;
    saveAsButton.disabled = locked;
    renameButton.disabled = locked || !message.canRename;
    deleteButton.disabled = locked || !message.canDelete;
    renderPresetSelect(message.presets || [], message.activePresetId || '', labels);
    renderItems(items, locked);
  });

  vscode.postMessage({ type: 'ready' });

  function renderPresetSelect(presetItems, activeId, labels) {
    const signature = presetItems.map(preset => `${preset.id}:${preset.name}:${preset.builtin}`).join('|');
    if (presetSelect.dataset.signature !== signature) {
      presetSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = labels.placeholder || 'Select a preset';
      presetSelect.appendChild(placeholder);
      appendGroup(labels.builtin || 'Built-in', presetItems.filter(preset => preset.builtin));
      appendGroup(labels.mine || 'My presets', presetItems.filter(preset => !preset.builtin));
      presetSelect.dataset.signature = signature;
    }
    presetSelect.value = activeId && [...presetSelect.options].some(option => option.value === activeId) ? activeId : '';
  }

  function appendGroup(label, presetItems) {
    if (presetItems.length === 0) {
      return;
    }
    const group = document.createElement('optgroup');
    group.label = label;
    for (const preset of presetItems) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      group.appendChild(option);
    }
    presetSelect.appendChild(group);
  }

  function renderItems(rows, running) {
    list.replaceChildren();
    for (const item of rows) {
      const row = document.createElement('div');
      row.className = 'op';
      row.dataset.id = item.id;
      row.title = item.tooltip || item.label;

      const grip = document.createElement('div');
      grip.className = 'grip';
      grip.draggable = !running;
      grip.title = dragLabel;
      grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', dragLabel);
      grip.innerHTML = gripSvg;
      grip.addEventListener('dragstart', event => {
        dragId = item.id;
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      });

      const checkbox = document.createElement('input');
      checkbox.className = 'check';
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.enabled);
      checkbox.disabled = running;

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = svg(icons[item.icon]);

      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = item.label;
      if (item.description) {
        const description = document.createElement('span');
        description.className = item.destructive ? 'description destructive' : 'description';
        description.textContent = item.description;
        text.appendChild(description);
      }

      row.append(grip, checkbox, icon, text);
      list.appendChild(row);
    }
  }

  function svg(path) {
    if (!path) {
      return '';
    }
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${path}</svg>`;
  }

  function clearMarkers() {
    dropTarget = null;
    for (const row of list.querySelectorAll('.op')) {
      row.classList.remove('before', 'after', 'dragging');
    }
  }

  function moveItem(order, fromId, toId, after) {
    if (!fromId || fromId === toId) {
      return order;
    }
    const next = order.filter(id => id !== fromId);
    let index = next.indexOf(toId);
    if (index < 0) {
      return order;
    }
    if (after) {
      index += 1;
    }
    next.splice(index, 0, fromId);
    return next;
  }
})();
