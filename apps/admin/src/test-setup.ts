import { configure } from '@testing-library/react';

// Délai d'attente des recherches asynchrones (findBy…, waitFor) : 1 s par défaut. Dans le
// pipeline complet, les tests de tous les paquets tournent en même temps sur le poste et une
// page chargée à la demande peut dépasser 1 s (14/11/2026 : 1,4 s pour le tableau de bord).
// Le test vérifie l'écran, pas la vitesse du poste.
configure({ asyncUtilTimeout: 5_000 });

// jsdom ne connaît pas encore showModal() ni close() de <dialog> (panneau d'un dossier,
// 05 §2.76) : ouverture et fermeture simulées par l'attribut open, comme le navigateur
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
