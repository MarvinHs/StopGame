'use strict';

/**
 * Banco de palabras para los bots, con sabor dominicano.
 * Cada categoría tiene, por letra, varias opciones separadas por "|".
 */
const BANK = {
  nombre: {
    A: 'Ana|Andrés|Alba|Armando|Altagracia', B: 'Beto|Bárbara|Bienvenido|Belkis', C: 'Carlos|Carmen|Cristian|Clara',
    D: 'Daniel|Dulce|Diógenes|Dayana', E: 'Elena|Eduardo|Esther|Emilio', F: 'Fernando|Fefa|Francisco|Flor',
    G: 'Gabriel|Gloria|Gregorio|Gisela', H: 'Hugo|Hilda|Héctor|Hilario', I: 'Iván|Isabel|Ignacio|Iris',
    J: 'José|Juana|Julio|Josefina', K: 'Karla|Kelvin|Katherine', L: 'Luis|Lucía|Leonel|Lourdes',
    M: 'María|Manuel|Milagros|Miguel', N: 'Nelson|Nancy|Nicolás|Nereida', Ñ: 'Ñico', O: 'Omar|Olga|Óscar|Odalis',
    P: 'Pedro|Paola|Pablo|Patria', Q: 'Quique|Quirino|Queila', R: 'Rosa|Ramón|Rafael|Rosanna',
    S: 'Sofía|Santiago|Sonia|Sergio', T: 'Tomás|Teresa|Tito|Tatiana', U: 'Úrsula|Ulises|Ubaldo',
    V: 'Víctor|Verónica|Vicente|Virginia', W: 'Wilson|Wendy|Wanda', X: 'Ximena|Xiomara',
    Y: 'Yolanda|Yamil|Yokasta|Yuderka', Z: 'Zoila|Zacarías|Zunilda',
  },
  apellido: {
    A: 'Álvarez|Almonte|Abreu|Acosta', B: 'Bautista|Batista|Brito|Báez', C: 'Castillo|Cruz|Cabrera|Contreras',
    D: 'Díaz|Durán|Delgado|De León', E: 'Espinal|Encarnación|Estévez|Espaillat', F: 'Fernández|Féliz|Frías|Florentino',
    G: 'García|Gómez|Guzmán|Guerrero', H: 'Hernández|Henríquez|Herrera|Holguín', I: 'Inoa|Iglesias|Ibarra',
    J: 'Jiménez|Javier|Jáquez', K: 'Kury', L: 'López|Lora|Liriano|Lantigua', M: 'Martínez|Mejía|Morel|Medina',
    N: 'Núñez|Nina|Nova|Navarro', O: 'Ortiz|Ozuna|Ovalle|Ogando', P: 'Pérez|Peña|Polanco|Paulino',
    Q: 'Quezada|Quiñones|Quiroz', R: 'Rodríguez|Rosario|Reyes|Ramírez', S: 'Sánchez|Santana|Suero|Soto',
    T: 'Torres|Tavárez|Taveras|Toribio', U: 'Ureña|Ulloa|Uceta', V: 'Vargas|Vásquez|Ventura|Valdez',
    Y: 'Yapor', Z: 'Zapata|Zorrilla|Zabala',
  },
  lugar: {
    A: 'Azua|Argentina|Alemania|Altamira', B: 'Baní|Bonao|Brasil|Barahona', C: 'Constanza|Cotuí|Colombia|Cuba',
    D: 'Dajabón|Dinamarca|Duvergé', E: 'Ecuador|Egipto|El Seibo|España', F: 'Francia|Finlandia|Fantino',
    G: 'Guatemala|Grecia|Gaspar Hernández', H: 'Haití|Higüey|Honduras|Hato Mayor', I: 'Italia|India|Imbert|Irlanda',
    J: 'Jarabacoa|Jamaica|Japón|Jimaní', K: 'Kenia|Kuwait', L: 'La Romana|La Vega|Lima|Luperón',
    M: 'Moca|México|Monte Plata|Madrid', N: 'Nagua|Neiba|Noruega|Nicaragua', O: 'Ocoa|Oviedo|Oslo|Omán',
    P: 'Puerto Plata|Panamá|Perú|Pedernales', Q: 'Quito|Qatar', R: 'Rusia|Río San Juan|Roma|Rumania',
    S: 'Santiago|Samaná|Suecia|San Cristóbal', T: 'Tenares|Tamboril|Turquía|Tokio', U: 'Uruguay|Ucrania',
    V: 'Venezuela|Villa Altagracia|Valverde|Vietnam', W: 'Washington', Y: 'Yamasá|Yaguate|Yemen', Z: 'Zambia|Zaragoza',
  },
  animal: {
    A: 'Araña|Águila|Alacrán|Avestruz', B: 'Burro|Ballena|Búho|Búfalo', C: 'Caballo|Cotorra|Cangrejo|Chivo',
    D: 'Delfín|Dromedario|Danta', E: 'Elefante|Erizo|Escorpión', F: 'Foca|Flamenco|Faisán',
    G: 'Gato|Gallina|Guinea|Gusano', H: 'Hormiga|Hipopótamo|Halcón|Hurón', I: 'Iguana|Impala|Ibis',
    J: 'Jirafa|Jaguar|Jutía|Jabalí', K: 'Koala|Kiwi', L: 'León|Lagartija|Loro|Lobo', M: 'Mono|Mariposa|Manatí|Mosquito',
    N: 'Nutria|Narval', Ñ: 'Ñu', O: 'Oso|Oveja|Orca|Ostra', P: 'Perro|Puerco|Paloma|Pato', Q: 'Quetzal',
    R: 'Ratón|Rana|Rinoceronte|Ruiseñor', S: 'Sapo|Serpiente|Salamandra|Sardina', T: 'Tigre|Tortuga|Toro|Tiburón',
    U: 'Urraca|Urogallo', V: 'Vaca|Venado|Víbora|Vencejo', W: 'Wombat', Y: 'Yegua|Yak', Z: 'Zorro|Zancudo|Zorrillo|Zumbador',
  },
  comida: {
    A: 'Aguacate|Arroz|Auyama|Arepa', B: 'Banana|Bacalao|Batata|Bizcocho', C: 'Cereza|Chinola|Coco|Chicharrón',
    D: 'Durazno|Dátil|Dulce de leche', E: 'Empanada|Espagueti|Ensalada|Espinaca', F: 'Fresa|Frijoles|Flan|Frambuesa',
    G: 'Guayaba|Guineo|Granada|Guandules', H: 'Higo|Habichuelas|Helado|Hamburguesa', I: 'Icaco',
    J: 'Jagua|Jamón|Jengibre|Jalea', K: 'Kiwi|Kipe', L: 'Limón|Lechosa|Locrio|Lasaña', M: 'Mango|Mangú|Mofongo|Melón',
    N: 'Naranja|Níspero|Nuez|Natilla', Ñ: 'Ñame', O: 'Okra|Ostiones', P: 'Piña|Pera|Pastelón|Plátano',
    Q: 'Queso|Quipe|Quesillo|Quinoa', R: 'Rábano|Remolacha|Repollo', S: 'Sandía|Sancocho|Salami|Sopa',
    T: 'Tamarindo|Tomate|Tostones|Toronja', U: 'Uva', V: 'Vainilla|Vainitas', W: 'Waffle',
    Y: 'Yuca|Yaniqueque|Yogur', Z: 'Zanahoria|Zapote|Zapallo',
  },
  color: {
    A: 'Azul|Amarillo|Añil|Aguamarina', B: 'Blanco|Beige|Burdeos|Bermellón', C: 'Café|Celeste|Carmesí|Cian',
    D: 'Dorado', E: 'Esmeralda|Escarlata', F: 'Fucsia', G: 'Gris|Granate', H: 'Hueso', I: 'Índigo', J: 'Jade',
    K: 'Kaki', L: 'Lila|Lavanda', M: 'Marrón|Morado|Magenta|Mostaza', N: 'Negro|Naranja|Nácar', O: 'Ocre|Oro|Oliva',
    P: 'Púrpura|Plateado|Perla|Pistacho', R: 'Rojo|Rosado|Rubí', S: 'Salmón|Sepia|Siena', T: 'Turquesa|Terracota|Tabaco',
    U: 'Ultramarino', V: 'Verde|Violeta|Vino', Z: 'Zafiro',
  },
  cosa: {
    A: 'Anillo|Almohada|Abanico|Aguja', B: 'Bate|Botella|Bombillo|Brocha', C: 'Cama|Cuchara|Cartera|Celular',
    D: 'Dado|Dedal|Destornillador|Disco', E: 'Escoba|Espejo|Estufa|Escalera', F: 'Foco|Florero|Fósforo|Freezer',
    G: 'Guitarra|Gorra|Gancho|Grapadora', H: 'Hacha|Hilo|Hamaca|Horno', I: 'Imán|Inodoro|Impresora',
    J: 'Jarra|Jabón|Juguete|Jeringa', K: 'Kayak', L: 'Lápiz|Llave|Lámpara|Libro', M: 'Mesa|Mochila|Martillo|Machete',
    N: 'Nevera|Navaja|Neumático', O: 'Olla|Ordenador', P: 'Pala|Peine|Plato|Paraguas', Q: 'Quinqué',
    R: 'Reloj|Radio|Regla|Rastrillo', S: 'Silla|Sartén|Sombrero|Sábana', T: 'Taza|Tenedor|Toalla|Tijera',
    U: 'Uniforme|Urna', V: 'Vaso|Vela|Ventilador|Valija', X: 'Xilófono', Y: 'Yoyo|Yunque|Yesquero', Z: 'Zapato|Zafacón',
  },
  profesion: {
    A: 'Abogado|Albañil|Arquitecto|Actor', B: 'Bombero|Barbero|Banquero|Bailarín', C: 'Cocinero|Carpintero|Chofer|Contador',
    D: 'Doctor|Dentista|Diseñador', E: 'Enfermero|Electricista|Escritor|Economista', F: 'Farmacéutico|Fotógrafo|Florista',
    G: 'Ganadero|Guía|Guardia', H: 'Herrero|Historiador', I: 'Ingeniero|Informático|Intérprete', J: 'Juez|Jardinero|Joyero',
    L: 'Locutor|Limpiabotas', M: 'Médico|Mecánico|Maestro|Motoconchista', N: 'Notario|Nutricionista|Niñera',
    O: 'Odontólogo|Obrero|Oculista', P: 'Policía|Panadero|Plomero|Pintor', Q: 'Químico|Quiropráctico',
    R: 'Recepcionista|Reportero|Relojero', S: 'Sastre|Secretaria|Soldador|Sacerdote', T: 'Taxista|Técnico|Traductor',
    U: 'Urólogo|Ujier', V: 'Veterinario|Vendedor|Vigilante', Z: 'Zapatero|Zoólogo',
  },
  cuerpo: {
    A: 'Abdomen|Antebrazo|Axila', B: 'Brazo|Boca|Barbilla', C: 'Cabeza|Codo|Cuello|Cintura', D: 'Dedo|Diente',
    E: 'Espalda|Estómago|Encía', F: 'Frente|Fémur', G: 'Garganta', H: 'Hombro|Hígado|Hueso', I: 'Intestino|Iris',
    L: 'Lengua|Labio', M: 'Mano|Muñeca|Mejilla|Muslo', N: 'Nariz|Nuca|Nudillo', O: 'Ojo|Oreja|Ombligo|Oído',
    P: 'Pie|Pierna|Pecho|Pestaña', R: 'Rodilla|Riñón|Rostro', S: 'Sien|Sangre', T: 'Tobillo|Talón|Tórax', U: 'Uña',
    V: 'Vena|Vientre|Vejiga',
  },
};

const { normalizeAnswer } = require('./text');

/** A qué parte del banco corresponde una categoría (según palabras clave). */
function bankFor(category) {
  const c = normalizeAnswer(category);
  if (c.includes('apellido')) return BANK.apellido;
  if (c.includes('nombre')) return BANK.nombre;
  if (c.includes('pais') || c.includes('ciudad') || c.includes('lugar') || c.includes('provincia')) return BANK.lugar;
  if (c.includes('animal')) return BANK.animal;
  if (c.includes('fruta') || c.includes('comida')) return BANK.comida;
  if (c.includes('color')) return BANK.color;
  if (c.includes('cosa') || c.includes('objeto')) return BANK.cosa;
  if (c.includes('profesion') || c.includes('oficio') || c.includes('trabajo')) return BANK.profesion;
  if (c.includes('cuerpo')) return BANK.cuerpo;
  return null;
}

/** Opciones que conoce un bot para esa categoría y letra (puede ser lista vacía). */
function wordsFor(category, letter) {
  const bank = bankFor(category);
  if (!bank || !bank[letter]) return [];
  return bank[letter].split('|');
}

module.exports = { wordsFor, BANK };
