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

    state.tasks.push(createdTask as Task);
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
    renderTasks();
  } catch (error) {
    console.error('Failed to load settings', error);
  }
};

export const loadLists = async () => {
  try {
    const existingLists = await window.electronAPI.getLists();
    state.lists = existingLists ?? [];
    renderLists();
    updateTasksTitle();
    renderListOptions(refs.addTaskListSelect, state.addTaskSelectedListId ?? state.selectedListId);
  } catch (error) {
    console.error('Failed to load lists', error);
  }
};
