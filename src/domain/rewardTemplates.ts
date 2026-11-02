export interface RewardTemplate {
  id: string
  name: string
  description: string
  price: number
  conditions: string
}

/** Mínimo de recompensas que hay que elegir al empezar (§132, petición del producto). */
export const MIN_INITIAL_REWARDS = 10

/**
 * Sugerencias para elegir rápido. Los precios son orientativos y editables; las de precio 0 son gratuitas.
 * Ninguna toca necesidades básicas (comida, sueño, descanso, educación): son beneficios adicionales (§137).
 */
export const REWARD_TEMPLATES: RewardTemplate[] = [
  { id: 'pick-movie', name: 'Elegir la película familiar', description: '', price: 40, conditions: 'Apta para todos' },
  { id: 'extra-tv', name: 'Una hora extra de tele', description: '', price: 100, conditions: 'Respetando las reglas de pantalla de la familia' },
  { id: 'extra-games', name: '30 minutos extra de videojuegos', description: '', price: 60, conditions: 'Respetando las reglas de pantalla de la familia' },
  { id: 'board-game', name: 'Elegir el juego de mesa', description: '', price: 25, conditions: '' },
  { id: 'dessert', name: 'Elegir el postre del domingo', description: '', price: 30, conditions: '' },
  { id: 'ice-cream', name: 'Salida a tomar un helado', description: '', price: 80, conditions: 'Fin de semana' },
  { id: 'pizza-night', name: 'Noche de pizza', description: '', price: 150, conditions: '' },
  { id: 'friend-play', name: 'Invitar a un amigo a jugar', description: '', price: 120, conditions: 'Previo aviso a los adultos' },
  { id: 'car-music', name: 'Elegir la música del viaje', description: '', price: 15, conditions: '' },
  { id: 'weekend-plan', name: 'Elegir la actividad del fin de semana', description: '', price: 200, conditions: '' },
  { id: 'skip-dishes', name: 'Un día libre de una tarea de casa', description: '', price: 50, conditions: 'Una vez por semana' },
  { id: 'small-gift', name: 'Un detalle o regalito pequeño', description: '', price: 250, conditions: 'Hasta el monto que acuerde la familia' },
  { id: 'first-pick', name: 'Ser el primero en elegir', description: 'Primero en elegir asiento, juego o turno.', price: 0, conditions: '' },
  { id: 'cheer', name: 'Un aplauso familiar', description: 'La familia lo celebra en voz alta.', price: 0, conditions: '' },
  { id: 'chef-helper', name: 'Ser ayudante del chef', description: '', price: 0, conditions: '' },
  { id: 'story-choice', name: 'Elegir el cuento o la historia', description: '', price: 10, conditions: '' },
]
