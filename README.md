# AI Form Check — osobny prototyp testowy

Ta strona jest **niezależnym MVP** analizy przysiadu z kamery telefonu.
Nie jest częścią produkcyjnej aplikacji [Moja Siłownia](https://durart.github.io/moja-silownia/).

## Otwórz test

Po włączeniu GitHub Pages (Settings → Pages → Deploy from a branch → main, /(root)):
**https://durart.github.io/moja-silownia-form-check/**

Można użyć symulacji pięciu przysiadów bez kamery albo spróbować analizy przez kamerę telefonu. Funkcja jest eksperymentalna, nie zastępuje trenera.

## Prywatność

- Żadne klatki kamery ani nagrania nie są wysyłane na serwer aplikacji.
- Model i biblioteka MediaPipe są pobierane z publicznych serwerów CDN, więc pierwsze uruchomienie wymaga internetu.
- Przetwarzanie obrazu odbywa się na urządzeniu; aplikacja nie zapisuje filmów, zdjęć ani wyników.
- Wynik opiera się na heurystyce 2D; nie jest poradą medyczną ani potwierdzeniem bezpieczeństwa ruchu.

Źródło: gałąź `feature/ai-form-check` repozytorium `durart/moja-silownia`.

## Debug

Dodaj `?fcdebug=1` do `/formcheck/demo.html` w celu pokazania FPS, fazy algorytmu i delegata.

## Co obejmuje test?

Przysiad ze strony bocznej: wykrycie pozy, szkic 33 punktów, liczenie powtórzeń, ocena głębokości i ruchu pięty. Brak integracji z historią i magazynem Mojej Siłowni.
