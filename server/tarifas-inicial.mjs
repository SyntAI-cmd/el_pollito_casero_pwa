/**
 * Listas de precios acordadas el 09/10/2026 (PRECIOS-FINAL.xlsx + respuestas de administración).
 *
 * Es una PROPUESTA: el tablero de Listas la muestra y nada se escribe hasta que administración
 * aplica. Los nombres son los de las fichas de producción, tal cual; si una ficha no existe con
 * ese nombre exacto, se informa y no se adivina.
 */
export const LISTAS_INICIALES = [
  { id: "mayorista", nombre: "Mayorista", pollo: 3900 },
  { id: "preferencial", nombre: "Preferencial", pollo: 4100 },
  { id: "comercial", nombre: "Comercial", pollo: 4300 },
  { id: "minorista", nombre: "Minorista", pollo: 4650 },
];

/**
 * Trozado: precio por mayor y por menor de cada corte. `oferta: true` quiere decir que todos los
 * clientes pagan el precio por mayor (hoy, el cuarto: hay mucho y sale en oferta).
 */
export const TROZADO_INICIAL = {
  "cuarto-trasero": { mayor: 3700, menor: 4000, oferta: true },
  alas: { mayor: 3350, menor: 3650 },
  suprema: { mayor: 9680, menor: 10000 },
  rancho: { mayor: 800, menor: 1000 },
  menudos: { mayor: 1700, menor: 2300 },
  muslo: { mayor: 4700, menor: 5100 },
  "pata-muslo": { mayor: 4700, menor: 5100 },
  pechuga: { mayor: 7000, menor: 7180 },
  "pechuga-con-alas": { mayor: 6000, menor: 6180 },
  garras: { mayor: 600, menor: 600 },
  "suprema-muslo": { mayor: 10840, menor: 10840 },
};

/**
 * Regla del trozado (decidida con las hojas de pedidos del 6 al 9 de octubre): un cliente va con
 * precio por mayor si en los últimos 7 días llevó 20 kg o más de trozado (todos los cortes juntos,
 * sin contar el pollo entero). Si no, por menor.
 */
export const REGLA_INICIAL = { umbralKg: 20, dias: 7 };

export const ASIGNACION_INICIAL = {
  mayorista: [
    "Fabio Tres Porteñas",
    "Pepe",
    "Joni San Martin",
    "Chino",
    "Ale Zabala",
    "Avícola La Blanca",
    "Exe Rodeo",
    "Daniel Guaymallen",
    "Oscar Cochabamba",
    "Oscar Godoy Cruz",
    "Oscar Tacalhuano",
    "Lautaro Sarmiento",
    "Mauro Godoy Cruz",
  ],
  preferencial: [
    "Alberto California",
    "Aníbal California",
    "Cristian",
    "Hernan San Martin",
    "Belen San Roque",
    "Rolando Maipu",
    "Leandro Godoy Cruz",
    "Franco Godoy Cruz",
    "Maxi Godoy Cruz",
    "Vanesa - ¨Godoy Cruz¨",
    "Vanesa - ¨Guaymallen¨",
    "Vanesa - ¨Lujan¨",
    "Vanesa - ¨Lujan 2 ¨",
  ],
  comercial: [
    "Gustavo Tres Porteñas",
    "Vanesa Tres Porteñas",
    "José California",
    "Claudio - ¨Costa¨",
    "Claudio - ¨LaValle¨",
    "Claudio - ¨Urquiza¨",
    "Abasto Lavalle",
    "Marcelo santa rosa",
    "Elena Santa Rosa",
    "Jose Escudero",
    "Pancho La Dormida",
    "Edith California",
    "Ariel Salvador",
    "Cristian B Guemes",
    "Luis puebla",
    "Agustina Godoy Cruz",
    "Hernán Pedriel",
    "Laureano lavalle",
    "Ceferino costa",
  ],
  minorista: [
    "Santiago 3 Porteñas",
    "Irene",
    "Gallego",
    "Leo",
    "Emanuel Colonia Segovia",
    "Fabian Jofre",
    "Norma Catita",
    "Luis La Dormida",
    "Emiliano La Paz",
    "Pajarito",
    "Rodolfo",
    "Chacho La Paz",
    "Andres",
    "Patricia Delgado",
    "Seba B° Municipal",
    "Gabi Ozan",
    "Ramiro",
    "Néstor",
    "Valentina",
    "Viviana ¨Nova Market¨",
  ],
};

/** Especiales: precio propio de pollo entero, fuera de las cuatro listas. */
export const ESPECIALES_INICIALES = {
  "Alfredo - ¨Negocio¨": 3750,
  "Alfredo Pirovano": 3750,
  "Alfredo Tucuman": 3750,
  "Matías Luján": 3730,
  Graziotin: 3750,
};

/** Sucursales de Benedetti: van sin precio en el remito (solo kilos); el pollo entero se les cobra 3750. */
export const SUCURSALES_BENEDETTI = [
  "Alsina",
  "Ameghino",
  "Arauca",
  "Azcuénaga",
  "Cervantes",
  "TUCUMAN",
  "Paso de los andes",
  "Nova Market",
  "General Paz",
  "Terra Malva",
  "Coquimbito",
  "Cortaderas",
  "Dorrego",
  "Lamadrid",
  "Mitre",
  "Pedemonte",
  "Taboada",
  "Serpa Luján",
];
export const POLLO_BENEDETTI = 3750;

/** Especiales sin precio: se cargan solo por kilo y conservan lo que tienen. */
export const SIN_PRECIO_ESPECIALES = ["Santiago Barzola", "Cecilia Fuentes"];

/** Nivel de trozado fijado a mano (no se calcula con el historial). */
export const TROZADO_FIJO = {
  Valentina: "menor",
  // Las Vanesas son un mismo cliente con sucursales: todas van por mayor.
  "Vanesa - ¨Godoy Cruz¨": "mayor",
  "Vanesa - ¨Guaymallen¨": "mayor",
  "Vanesa - ¨Lujan¨": "mayor",
  "Vanesa - ¨Lujan 2 ¨": "mayor",
};

/** Fichas a eliminar (no compran). Las que tienen historial quedan archivadas, no se pierden. */
export const ELIMINAR = [
  "Joni San Martín",
  "Hugo Gonzales",
  "Juan Lucero",
  "Miranda",
  "Joel Junin",
  "Monica palmira",
  "Sonia California",
  "Tamagnone",
  "Viomar (varios)",
  "Sonia Costa",
  "Ruben Lucero",
  "Rodrigo Maipu",
  "Hector Palmira",
  "Enzo Santa Rosa",
  "Mauricio Cardenas",
  "Benedetti",
  "Arian - Facturar A Cuit De Joel Junin",
  "Leo Lucero",
  "Jose 3P",
  "Miguel Mirador",
];
/** Pedidos de eliminar que chocan con las hojas de la semana: se proponen sin tildar. */
export const ELIMINAR_DUDOSOS = {
  "Dario Aguero": "Llevó pollo el 08/10.",
};
