# Pruebas funcionales de EcoClima Chimborazo

## Pruebas automatizadas sin internet

Requieren Node.js 18 o posterior; no instalan paquetes ni hacen solicitudes reales.

```powershell
node --test tests/ecoclima.test.cjs
```

El harness ejecuta el JavaScript inline de `index.html` en un contexto aislado y reemplaza `fetch`, el DOM mínimo y los temporizadores. Comprueba respuesta NASA válida, parámetros y fechas, campos/series faltantes, valores `null`, HTTP 400/404/429/500/503, error de red, aborto al cumplirse 6000 ms, cuerpo o estructura vacíos, JSON inválido, cambio de sector, actualización manual y umbrales del semáforo.

**Criterio para todos los fallos:** `data-mode="fallback"`, el aviso comienza exactamente con `MODO RESPALDO (DATOS SIMULADOS)`, los valores simulados se renderizan y la atribución dice que son simulados, sin atribuirlos a NASA POWER. **Criterio para éxito:** el aviso es `HISTÓRICOS (ENERO 2024)` y la atribución NASA aparece solo para la respuesta validada.

## Pruebas manuales en navegador

Abre `index.html` en Chrome, Edge o Firefox. Para comprobar un resultado real NASA POWER, permite la conexión y CORS al dominio de NASA POWER; desconectar la red fuerza el respaldo. Los mocks de la suite automatizada no necesitan red.

| Prueba | Pasos | Resultado esperado |
|---|---|---|
| Navegación por teclado | Recarga la página. Usa `Tab` / `Shift+Tab` hasta el selector, cambia localidad con flechas y confirma; llega al botón y pulsa `Enter` o `Espacio`. | Orden de foco lógico, foco visible, controles operables sin ratón; localidad y datos se actualizan. |
| Consulta válida | Con internet, carga o actualiza la página. | Se ven período y aviso `HISTÓRICOS (ENERO 2024)`, métricas, semáforo y curva diaria. No aparece “MODO RESPALDO”. |
| Respaldo | En DevTools, bloquea `power.larc.nasa.gov` o desconecta la red y pulsa Actualizar. | Aparece inequívocamente `MODO RESPALDO (DATOS SIMULADOS)`; los datos se distinguen como simulados y no se presentan como observaciones NASA. |
| Cambio de sector | Selecciona Riobamba Centro, Guano, Colta y Alausí, uno por uno. | El nombre, consulta y resultados corresponden al sector seleccionado. |
| Semáforo | En el harness, verifica los límites de 2 °C y 5 °C; en navegador, inspecciona el texto y color del indicador. | Rojo/ALTO para ≤ 2 °C; amarillo/PRECAUCIÓN para > 2 °C y ≤ 5 °C; verde/BAJO para > 5 °C. |
| 1280 × 720 | Abre DevTools responsive y fija el viewport en 1280 × 720. | Paneles en dos columnas; selector, botón, métricas, gráfica, aviso y fuente visibles, sin desbordamiento horizontal. |
| 1920 × 1080 | Fija el viewport en 1920 × 1080. | Contenido centrado y legible, sin estirarse a todo el ancho; ambas tarjetas y sus métricas se leen de un vistazo. |
| Móvil | Prueba 375 × 812 y 320 × 640. | Una columna; controles apilados y utilizables; textos y gráfica no desbordan; se puede desplazar verticalmente. |
| Anuncio accesible | Con lector de pantalla activo, cambia de sector y fuerza respaldo; navega por el SVG. | El cambio de estado se anuncia por `role=status` / `aria-live`; el SVG tiene nombre y descripción accesibles. |
