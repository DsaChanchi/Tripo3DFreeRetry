# Tripo3DFreeRetry

# Tripo Studio Free Retry Manager

Userscript para **Tripo Studio** que permite escanear modelos disponibles y procesar automáticamente los **Free Retry** encontrados mediante varias iteraciones.

## Características

* 🔎 Escaneo automático de los modelos disponibles en Tripo Studio.
* 🎯 Detección de modelos que disponen de **Free Retry**.
* 🔄 Procesamiento de los candidatos mediante varias iteraciones.
* ⚡ Gestión de hasta **10 procesos simultáneos**.
* ⏸️ Pausar y reanudar el proceso.
* ⛔ Detener el proceso en cualquier momento.
* 🧹 Detección y cierre automático de determinados popups de suscripción o límite.
* 📋 Registro detallado de las operaciones realizadas.
* 📑 Copia del log al portapapeles.
* ♻️ Reutilización de la lista de candidatos entre iteraciones.
* 🚫 No realiza exportaciones ni descargas de archivos.
* 🖥️ Interfaz integrada directamente en Tripo Studio.

## Requisitos

Necesitas un navegador compatible con Userscripts y una extensión como:

* Tampermonkey
* Violentmonkey

También necesitas acceso a:

`https://studio.tripo3d.ai/`

## Instalación

1. Instala **Tampermonkey** o **Violentmonkey** en tu navegador.
2. Crea un nuevo Userscript.
3. Copia el contenido del archivo `.user.js` de este proyecto.
4. Guarda el script.
5. Accede a Tripo Studio.
6. La interfaz **Tripo Free Retry** aparecerá automáticamente.

## Uso

### 1. Escanear modelos

Pulsa:

**Escanear modelos**

El script recorrerá el panel de modelos y recopilará los modelos disponibles.

Una vez finalizado el escaneo, se mostrará el número de modelos encontrados.

### 2. Iniciar Free Retry

Pulsa:

**Iniciar Free Retry**

El script comprobará los modelos para localizar aquellos que tengan disponible el botón **Free Retry**.

Los candidatos encontrados se almacenan para utilizarlos durante las distintas iteraciones.

### 3. Procesamiento

Una vez obtenida la lista de candidatos, el script procesa los Free Retry de forma automática.

La configuración actual utiliza:

* **3 iteraciones**
* **10 procesos simultáneos como máximo**
* **10 segundos de espera entre acciones**
* **120 segundos de tiempo máximo estimado por generación**

Los valores pueden modificarse directamente en `RETRY_CONFIG`.

## Iteraciones

La lista de candidatos se obtiene inicialmente y posteriormente se reutiliza.

Por ejemplo:

```text
Escaneo inicial
      ↓
Candidatos Free Retry
      ↓
Iteración 1
      ↓
Iteración 2
      ↓
Iteración 3
```

El script **no vuelve a escanear todos los modelos antes de cada iteración**.

## Controles

La interfaz incluye los siguientes controles:

| Botón              | Función                                  |
| ------------------ | ---------------------------------------- |
| Escanear modelos   | Busca y registra los modelos disponibles |
| Iniciar Free Retry | Inicia el procesamiento                  |
| Pausar             | Pausa temporalmente el proceso           |
| Reanudar           | Continúa el proceso pausado              |
| Detener            | Detiene el proceso                       |
| Copiar log         | Copia el registro al portapapeles        |
| Limpiar log        | Limpia el registro mostrado              |
| Reset              | Reinicia el estado del script            |

## Configuración

La configuración principal se encuentra en:

```javascript
const RETRY_CONFIG = {
    clickWait: 10000,
    maxConcurrent: 10,
    generationTimeout: 120000,
    pollInterval: 1000,
    retryButtonTimeout: 60000,
    afterModelClickWait: 1200,
    iterations: 3,
    popupCheckInterval: 500,
    popupCloseWait: 700
};
```

### `iterations`

Número de iteraciones que se ejecutarán.

```javascript
iterations: 3
```

### `maxConcurrent`

Número máximo de procesos considerados activos simultáneamente.

```javascript
maxConcurrent: 10
```

### `clickWait`

Tiempo de espera entre acciones de Free Retry.

```javascript
clickWait: 10000
```

El valor está expresado en milisegundos.

## Registro

El script mantiene un registro de las operaciones realizadas.

Ejemplos de información registrada:

* Modelos encontrados.
* Candidatos con Free Retry.
* Project ID.
* Free Retry disponibles.
* Procesos activos.
* Iteración actual.
* Errores encontrados.
* Estado del proceso.

El registro puede copiarse mediante:

**Copiar log**

## Seguridad y funcionamiento

Este proyecto funciona mediante un Userscript ejecutado en el navegador sobre la interfaz de Tripo Studio.

El script interactúa con elementos visibles de la página, incluyendo:

* Modelos.
* Botones.
* Paneles.
* Diálogos.
* Botón Free Retry.

No realiza exportaciones ni descargas de archivos.

## Limitaciones

El funcionamiento depende de la interfaz actual de Tripo Studio.

Si Tripo modifica:

* Selectores HTML.
* Atributos `data-trace`.
* Estructura del panel de modelos.
* Botones.
* Diálogos.
* Flujo de generación.

puede ser necesario actualizar el script.

## Aviso

Este proyecto no está afiliado, patrocinado ni mantenido por Tripo Studio.

El uso del script es responsabilidad del usuario. Comprueba siempre las condiciones de uso de Tripo Studio antes de utilizar automatizaciones.

## Autor

**DsaChanchi - Troyano**

## Licencia

Este proyecto se publica con fines educativos y de automatización personal.

Si deseas utilizar, modificar o redistribuir el proyecto, revisa y establece la licencia que corresponda al repositorio.
