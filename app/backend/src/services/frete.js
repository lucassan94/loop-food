import { query } from '../config/database.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

// Fórmula de Haversine para calcular distância entre coordenadas
export function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raio da Terra em km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// Buscar dados do restaurante para cálculo de distância
export async function getRestaurantCoords(restaurantId) {
  const result = await query(
    'SELECT latitude, longitude, tempo_preparo_min FROM restaurantes WHERE id = $1',
    [restaurantId || config.restaurantId]
  );
  return result.rows[0] || null;
}

// Calcular frete baseado na distância e matriz de raios
export async function calcularFrete(latitudeCliente, longitudeCliente, restaurantId) {
  const restaurante = await getRestaurantCoords(restaurantId);
  const rid = restaurantId || config.restaurantId;

  if (!restaurante || !restaurante.latitude || !restaurante.longitude) {
    // Fallback: frete fixo se não houver coordenadas
    const result = await query(
      'SELECT raio_km, tempo_min, tempo_max, custo FROM raios_entrega WHERE restaurant_id = $1 ORDER BY raio_km ASC LIMIT 1',
      [rid]
    );
    const faixa = result.rows[0] || { raio_km: 1, tempo_min: 10, tempo_max: 15, custo: 6.00 };
    return {
      distancia_km: null,
      faixa_raio: faixa.raio_km,
      tempo_min: faixa.tempo_min,
      tempo_max: faixa.tempo_max,
      custo: parseFloat(faixa.custo),
      tempo_preparo: restaurante?.tempo_preparo_min || 20,
    };
  }

  const distancia = calcularDistancia(
    parseFloat(restaurante.latitude),
    parseFloat(restaurante.longitude),
    latitudeCliente,
    longitudeCliente
  );

  // Buscar faixa de raio adequada
  const result = await query(
    `SELECT raio_km, tempo_min, tempo_max, custo
     FROM raios_entrega
     WHERE restaurant_id = $1 AND raio_km >= $2
     ORDER BY raio_km ASC
     LIMIT 1`,
    [rid, Math.ceil(distancia)]
  );

  const faixa = result.rows[0];

  if (!faixa) {
    throw new AppError('Desculpe, não entregamos na sua região.', 400);
  }

  return {
    distancia_km: Math.round(distancia * 100) / 100,
    faixa_raio: faixa.raio_km,
    tempo_min: faixa.tempo_min,
    tempo_max: faixa.tempo_max,
    custo: parseFloat(faixa.custo),
    tempo_preparo: restaurante?.tempo_preparo_min || 20,
  };
}

/**
 * Valida que a entrega está DENTRO do raio antes de criar o pedido.
 *
 * Usada na criação de pedido (COD e online) para IMPEDIR pedidos fora do
 * raio de entrega — o frontend não deve conseguir burlar enviando um frete
 * adulterado ou um endereço de outra região.
 *
 * - Com coordenadas: calcula a distância real e lança erro se fora do raio;
 *   também confere que o valor_frete enviado bate com o calculado aqui
 *   (anti-adulteração).
 * - Sem coordenadas: valida apenas o estado (fallback — mesmo critério do
 *   endpoint /calcular-frete).
 *
 * Retorna o frete calculado (autoritativo).
 */
export async function validarEntrega(restaurantId, { latitude, longitude, estado, valorFrete }) {
  const rid = restaurantId || config.restaurantId;

  // ── Com coordenadas: distância real + conferência do frete ──
  if (latitude && longitude) {
    const frete = await calcularFrete(parseFloat(latitude), parseFloat(longitude), rid);

    // Conferência anti-adulteração: frete enviado deve bater com o calculado.
    // O frontend usa exatamente o valor do /calcular-frete, então divergência
    // significa request adulterado (ex.: frete zerado para burlar o total).
    if (typeof valorFrete === 'number' && Math.abs(parseFloat(valorFrete) - frete.custo) > 0.01) {
      throw new AppError(
        'O valor do frete informado não confere com o calculado. Recarregue o carrinho e tente novamente.',
        400
      );
    }

    return frete;
  }

  // ── Sem coordenadas: validar estado (fallback de segurança) ──
  const restaurante = await query(
    'SELECT estado, tempo_preparo_min FROM restaurantes WHERE id = $1',
    [rid]
  );
  const restEstado = restaurante.rows[0]?.estado;

  if (estado && restEstado && String(estado).toUpperCase() !== String(restEstado).toUpperCase()) {
    throw new AppError(
      `Desculpe, não entregamos em ${String(estado).toUpperCase()}. Nosso raio de entrega abrange apenas ${String(restEstado).toUpperCase()}.`,
      400
    );
  }

  // Fallback: frete padrão (primeiro raio) — mesmo critério do /calcular-frete
  const result = await query(
    'SELECT raio_km, tempo_min, tempo_max, custo FROM raios_entrega WHERE restaurant_id = $1 ORDER BY raio_km ASC LIMIT 1',
    [rid]
  );
  const faixa = result.rows[0] || { raio_km: 1, tempo_min: 10, tempo_max: 15, custo: 6.00 };

  return {
    distancia_km: null,
    faixa_raio: faixa.raio_km,
    tempo_min: faixa.tempo_min,
    tempo_max: faixa.tempo_max,
    custo: parseFloat(faixa.custo),
    tempo_preparo: restaurante.rows[0]?.tempo_preparo_min || 20,
  };
}
