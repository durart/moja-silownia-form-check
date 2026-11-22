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


## Etap 3: kalibracja i precyzja

Kalibracja uruchamia się automatycznie po włączeniu kamery. Stań bokiem do telefonu, w całości w kadrze, wyprostuj kolana i pozostań nieruchomo przez około 1–2 sekundy. Podgląd pokazuje postęp i wskazówki, jeśli sylwetka jest zbyt mała, ucięta lub ustawiona przodem.

- Przed zakończeniem kalibracji powtórzenia i błędy techniki nie są oceniane.
- Kąt startowy jest ostrożnie dostosowany do wykrytej pozycji stojącej (nie zmienia się progu wymaganej głębokości).
- Kolory ostrzeżeń mają opóźnienie kilku kolejnych wiarygodnych klatek, aby zmniejszyć migotanie i przypadkowe alarmy.
- Przy utracie kadru ocena znika; po dłuższej utracie pozycji kalibracja może zostać powtórzona automatycznie.
- Symulacje dodają okres kalibracji przed odtwarzanym ruchem.

**Ograniczenia:** kamera 2D nie mierzy rzeczywistej głębokości 3D ani nacisku pięt na podłoże. Progi pozostają eksperymentalnymi heurystykami, wymagającymi oceny na różnych osobach i urządzeniach. Nie używaj ostrzeżeń jako rozstrzygającej oceny bezpieczeństwa.

Testy: GitHub Actions uruchamia `node --test tests/*.test.mjs` przy zmianach na gałęziach rozwojowych.
