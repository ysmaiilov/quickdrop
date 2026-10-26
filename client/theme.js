// QuickDrop: жарык / караңгы тема.
// <head>'де эң алгач жүктөлөт: бет чийилгенге чейин data-theme коюлат (жарк этпеши үчүн).
// Колдонуучу тандаса, ал сакталат; болбосо системанын тандоосу (prefers-color-scheme) колдонулат.

(function () {
  'use strict';

  const STORAGE_KEY = 'quickdrop.theme';
  const LIGHT_COLOR = '#f4f6fb';
  const DARK_COLOR = '#0b1120';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function savedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function effectiveTheme() {
    return savedTheme() || (media && media.matches ? 'dark' : 'light');
  }

  function apply() {
    const saved = savedTheme();
    if (saved) document.documentElement.dataset.theme = saved;
    else delete document.documentElement.dataset.theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? DARK_COLOR : LIGHT_COLOR);

    const button = document.getElementById('themeBtn');
    if (button) {
      const dark = effectiveTheme() === 'dark';
      button.textContent = dark ? '☀️' : '🌙';
      // i18n.js бул атрибутту тандалган тилге которот
      button.setAttribute('title', dark ? 'Тема: жарык' : 'Тема: караңгы');
      button.setAttribute('aria-label', dark ? 'Тема: жарык' : 'Тема: караңгы');
    }
  }

  function toggle() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      // сакталбаса да, учурдагы бетте иштейт
      document.documentElement.dataset.theme = next;
    }
    apply();
  }

  apply();
  if (media && media.addEventListener) media.addEventListener('change', apply);

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('themeBtn');
    if (button) button.addEventListener('click', toggle);
    apply();
  });
})();
