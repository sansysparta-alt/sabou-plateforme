# Échantillon de voix de US-005

Fabriqué par `scripts/make-fixtures.ts` (reproductible : mêmes fichiers à l'octet près).

| Fichier             | Contenu                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `voix-propre.flac`  | 90 s de lecture en français, 16 kHz mono : la référence d'intelligibilité                                                |
| `voix-bruitee.flac` | la même voix dans un « marché » : brouhaha de trois autres voix et bruit grave continu, rapport signal sur bruit de 5 dB |

## Sources : enregistrements LibriVox, domaine public

| Source (archive.org)                                                                                        | Fichier                                       | SHA-1                                      | Usage                                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `contes_temps_passe_librivox` : Perrault, _Histoires ou Contes du temps passé_, lu par Ezwa                 | `contes_du_temps_passe_03_perrault_64kb.mp3`  | `682db93e1340ba373bd77778147ab1d3ca334e2e` | voix (à partir de 36 s) et une voix du brouhaha (à partir de 200 s) |
| `les_contes_de_la_becasse_0809_librivox` : Maupassant, _Les contes de la bécasse_, lu par Bernard et Didier | `lescontesdelabecasse_01_maupassant_64kb.mp3` | `53d494409893879e34ae5a24a2986b3a341620a0` | voix du brouhaha                                                    |
| idem                                                                                                        | `lescontesdelabecasse_03_maupassant_64kb.mp3` | `51c50d1eae583aa5eee00d71a73e60bc5a073162` | voix du brouhaha                                                    |

Licence indiquée par archive.org : `http://creativecommons.org/licenses/publicdomain/`. Les enregistrements LibriVox sont versés au domaine public par leurs lecteurs.

## Voix réelles, mais pas des données réelles du projet

Ces enregistrements sont de **vraies voix** : celles de lecteurs bénévoles qui les ont eux-mêmes versées au domaine public. Ce ne sont ni des praticiens ni des patients, et ils ne contiennent aucune donnée de santé : la règle « aucune donnée réelle avant l'hébergement souverain » (CLAUDE.md) ne les vise pas. Une voix réelle est préférée à une voix de synthèse parce que RNNoise a été entraîné sur de vraies voix : une voix de synthèse fausserait la mesure.

Aucune voix de praticien et aucun enregistrement fait pendant les essais sur téléphone ne sont versionnés : seules leurs mesures le sont.
