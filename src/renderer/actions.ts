import type { Task } from '../types';
import { refs } from './dom.js';
import { renderLists, renderListOptions } from './lists.js';
import { renderTasks, updateTasksTitle } from './tasks.js';
import { state } from './state.js';

export const addTask = async () => {
  const text = refs.input?.value.trim();
  if (!text) return;

  try {
    const createdTask = await window.electronAPI.addTask(text, state.addTaskSelectedListId ?? state.selectedListId);
    if (!createdTask || (createdTask as any).error) {
      return;
    }

    state.tasks.push({ ...(createdTask as Task), priority: (createdTask as any).priority ?? 'none' });
    if (refs.input) {
      refs.input.value = '';
      refs.input.focus();
    }
    renderTasks();
  } catch (error) {
    console.error('Failed to add task', error);
  }
};

export const loadTasks = async () => {
  try {
    const existingTasks = await window.electronAPI.getTasks();
    state.tasks.splice(0, state.tasks.length, ...existingTasks);
    state.tasks.forEach((t) => {
      if ((t as any).listId === undefined) {
        t.listId = null;
      }
      if (!(t as any).priority) {
        (t as any).priority = 'none';
      }
      if ((t as any).reminderDate === undefined) {
        (t as any).reminderDate = null;
      }
      if ((t as any).reminderTime === undefined) {
        (t as any).reminderTime = null;
      }
    });
    renderTasks();
  } catch (error) {
    console.error('Failed to load tasks', error);
  }
};

export const loadSettings = async () => {
  try {
    const settings = await window.electronAPI.getSettings();
    state.showCompleted = settings.showCompleted;
    state.timeFormat = settings.timeFormat ?? '12h';
    state.dateFormat = settings.dateFormat ?? state.dateFormat;
    renderTasks();
  } catch (error) {
    console.error('Failed to load settings', error);
  }
};

export const loadLists = async () => {
  try {
    const existingLists = await window.electronAPI.getLists();
    state.lists = (existingLists ?? []).map((l, idx) => ({
      ...l,
      position: typeof l.position === 'number' ? l.position : idx,
    }));
    state.lists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    renderLists();
    updateTasksTitle();
    renderListOptions(refs.addTaskListMenu, state.addTaskSelectedListId ?? state.selectedListId, refs.addTaskListLabel);
  } catch (error) {
    console.error('Failed to load lists', error);
  }
};
