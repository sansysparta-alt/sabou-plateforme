# Modèle RNNoise

`cb.rnnn` : modèle « conjoined-burgers » (2018-08-28) du dépôt
[GregorR/rnnoise-models](https://github.com/GregorR/rnnoise-models), commit
`3eee541a283fd3b8f81b85b1748e3b9ccbefa04d`, fichier `conjoined-burgers-2018-08-28/cb.rnnn`.

- SHA-256 : `f1357c4e5be9dee8467bead486dfced2d75b640c26ad0b594fa7f102322371d9` (vérifié par les tests).
- Droits : selon le README du dépôt, hors le dossier `tools/` et le README, « none of this work is creative and thus none of it is subject to copyright ».
- Lu par le filtre `arnndn` de FFmpeg.

Choix par la mesure (novembre 2026, récit US-005), sur l'échantillon de `fixtures/` : les cinq modèles du
dépôt ont été comparés par l'indice STOI. À pleine force, `cb` est le meilleur (0,803) ; à mi-force,
réglage retenu, les cinq se valent (0,838 à 0,840). Détail dans `05_Choix_Techniques.md` §2.17.
