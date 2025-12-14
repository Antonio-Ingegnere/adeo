const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export const refs = {
  input: byId<HTMLInputElement>('message-input'),
  addButton: byId<HTMLButtonElement>('add-button'),
  tasksList: byId<HTMLDivElement>('tasks-list'),
  emptyState: byId<HTMLDivElement>('empty-state'),
  overlay: byId<HTMLDivElement>('edit-overlay'),
  editInput: byId<HTMLInputElement>('edit-input'),
  editDoneInput: byId<HTMLInputElement>('edit-done'),
  editDetailsInput: byId<HTMLTextAreaElement>('edit-details'),
  cancelEditBtn: byId<HTMLButtonElement>('cancel-edit'),
  saveEditBtn: byId<HTMLButtonElement>('save-edit'),
  listsList: byId<HTMLDivElement>('lists-list'),
  listsEmpty: byId<HTMLDivElement>('lists-empty'),
  listsToggle: byId<HTMLButtonElement>('lists-toggle'),
  addListBtn: byId<HTMLButtonElement>('add-list-button'),
  listOverlay: byId<HTMLDivElement>('list-overlay'),
  listInput: byId<HTMLInputElement>('list-input'),
  cancelListBtn: byId<HTMLButtonElement>('cancel-list'),
  saveListBtn: byId<HTMLButtonElement>('save-list'),
  addTaskListSelect: byId<HTMLSelectElement>('add-task-list'),
  modalListSelect: byId<HTMLSelectElement>('modal-list-select'),
  priorityPicker: byId<HTMLButtonElement>('priority-picker'),
  priorityMenu: byId<HTMLDivElement>('priority-menu'),
  priorityChip: byId<HTMLSpanElement>('priority-chip'),
  priorityLabel: byId<HTMLSpanElement>('priority-label'),
  reminderPicker: byId<HTMLButtonElement>('reminder-picker'),
  reminderMenu: byId<HTMLDivElement>('reminder-menu'),
  reminderLabel: byId<HTMLSpanElement>('reminder-label'),
  reminderDateInput: byId<HTMLInputElement>('reminder-date'),
  reminderTimeSelect: byId<HTMLSelectElement>('reminder-time'),
  settingsOverlay: byId<HTMLDivElement>('settings-overlay'),
  settingsRadio12: byId<HTMLInputElement>('time-12'),
  settingsRadio24: byId<HTMLInputElement>('time-24'),
  settingsSave: byId<HTMLButtonElement>('save-settings'),
  settingsCancel: byId<HTMLButtonElement>('cancel-settings'),
  dateFormatSelect: byId<HTMLSelectElement>('date-format'),
  tasksTitleEl: document.querySelector<HTMLParagraphElement>('.tasks-title'),
};

export const dropIndicator = (() => {
  const el = document.createElement('div');
  el.className = 'drop-indicator';
  return el;
})();

export const listDropIndicator = (() => {
  const el = document.createElement('div');
  el.className = 'list-drop-indicator';
  return el;
})();
