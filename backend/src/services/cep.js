// Serviço de busca de CEP com fallback entre APIs

// Mapa de coordenadas aproximadas de cidades brasileiras (centro da cidade)
// Usado quando BrasilAPI não retorna coordenadas e ViaCEP é o fallback
const CIDADE_COORDS = {
  'são paulo': { lat: -23.5505, lng: -46.6333 },
  'sao paulo': { lat: -23.5505, lng: -46.6333 },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729 },
  'belo horizonte': { lat: -19.9167, lng: -43.9345 },
  'brasília': { lat: -15.7801, lng: -47.9292 },
  'brasilia': { lat: -15.7801, lng: -47.9292 },
  'salvador': { lat: -12.9714, lng: -38.5014 },
  'fortaleza': { lat: -3.7319, lng: -38.5267 },
  'curitiba': { lat: -25.4290, lng: -49.2671 },
  'recife': { lat: -8.0476, lng: -34.8770 },
  'porto alegre': { lat: -30.0346, lng: -51.2177 },
  'manaus': { lat: -3.1190, lng: -60.0217 },
  'belém': { lat: -1.4558, lng: -48.4902 },
  'belem': { lat: -1.4558, lng: -48.4902 },
  'goiânia': { lat: -16.6869, lng: -49.2648 },
  'goiania': { lat: -16.6869, lng: -49.2648 },
  'guarulhos': { lat: -23.4539, lng: -46.5333 },
  'campinas': { lat: -22.9056, lng: -47.0608 },
  'são bernardo do campo': { lat: -23.6939, lng: -46.5650 },
  'sao bernardo do campo': { lat: -23.6939, lng: -46.5650 },
  'santo andré': { lat: -23.6639, lng: -46.5383 },
  'santo andre': { lat: -23.6639, lng: -46.5383 },
  'osasco': { lat: -23.5329, lng: -46.7917 },
  'ribeirão preto': { lat: -21.1699, lng: -47.8099 },
  'ribeirao preto': { lat: -21.1699, lng: -47.8099 },
  'são josé dos campos': { lat: -23.1896, lng: -45.8842 },
  'sao jose dos campos': { lat: -23.1896, lng: -45.8842 },
  'são luís': { lat: -2.5387, lng: -44.2828 },
  'sao luis': { lat: -2.5387, lng: -44.2828 },
  'maceió': { lat: -9.6498, lng: -35.7089 },
  'maceio': { lat: -9.6498, lng: -35.7089 },
  'natal': { lat: -5.7945, lng: -35.2110 },
  'teresina': { lat: -5.0892, lng: -42.8096 },
  'joão pessoa': { lat: -7.1153, lng: -34.8610 },
  'joao pessoa': { lat: -7.1153, lng: -34.8610 },
  'aracaju': { lat: -10.9095, lng: -37.0677 },
  'campo grande': { lat: -20.4485, lng: -54.6296 },
  'cuiabá': { lat: -15.5989, lng: -56.0949 },
  'cuiaba': { lat: -15.5989, lng: -56.0949 },
  'florianópolis': { lat: -27.5945, lng: -48.5478 },
  'florianopolis': { lat: -27.5945, lng: -48.5478 },
  'vitória': { lat: -20.3155, lng: -40.3128 },
  'vitoria': { lat: -20.3155, lng: -40.3128 },
  'palmas': { lat: -10.2502, lng: -48.2927 },
  'porto velho': { lat: -8.7619, lng: -63.9020 },
  'boa vista': { lat: 2.8195, lng: -60.6734 },
  'rio branco': { lat: -9.9740, lng: -67.8076 },
  'macapá': { lat: 0.0349, lng: -51.0694 },
  'macapa': { lat: 0.0349, lng: -51.0694 },
  'são caetano do sul': { lat: -23.6227, lng: -46.5548 },
  'sao caetano do sul': { lat: -23.6227, lng: -46.5548 },
  'diadema': { lat: -23.6857, lng: -46.6204 },
  'mauá': { lat: -23.6677, lng: -46.4603 },
  'maua': { lat: -23.6677, lng: -46.4603 },
  'jundiaí': { lat: -23.1863, lng: -46.8842 },
  'jundiai': { lat: -23.1863, lng: -46.8842 },
  'santos': { lat: -23.9608, lng: -46.3336 },
  'sorocaba': { lat: -23.5017, lng: -47.4523 },
  'piracicaba': { lat: -22.7338, lng: -47.6476 },
  'bauru': { lat: -22.3145, lng: -49.0585 },
  'taubaté': { lat: -23.0264, lng: -45.5554 },
  'taubate': { lat: -23.0264, lng: -45.5554 },
  'limeira': { lat: -22.5642, lng: -47.4020 },
  'franca': { lat: -20.5382, lng: -47.4005 },
  'são josé do rio preto': { lat: -20.8198, lng: -49.3850 },
  'sao jose do rio preto': { lat: -20.8198, lng: -49.3850 },
  'mogí das cruzes': { lat: -23.5227, lng: -46.1937 },
  'mogi das cruzes': { lat: -23.5227, lng: -46.1937 },
  'suzano': { lat: -23.5430, lng: -46.3122 },
  'itapevi': { lat: -23.5493, lng: -46.9345 },
  'barueri': { lat: -23.5108, lng: -46.8760 },
  'embu das artes': { lat: -23.6491, lng: -46.8522 },
  'carapicuíba': { lat: -23.5231, lng: -46.8407 },
  'carapicuiba': { lat: -23.5231, lng: -46.8407 },
  'itapevi': { lat: -23.5493, lng: -46.9345 },
  'cotia': { lat: -23.6035, lng: -46.9185 },
  'ferraz de vasconcelos': { lat: -23.5413, lng: -46.3678 },
  'itapecerica da serra': { lat: -23.7172, lng: -46.8490 },
  'taboão da serra': { lat: -23.6260, lng: -46.7913 },
  'taboao da serra': { lat: -23.6260, lng: -46.7913 },
  'francisco morato': { lat: -23.2816, lng: -46.7446 },
  'franco da rocha': { lat: -23.3184, lng: -46.7237 },
  'indaiatuba': { lat: -23.0889, lng: -47.2133 },
  'hortolândia': { lat: -22.8525, lng: -47.2205 },
  'hortolandia': { lat: -22.8525, lng: -47.2205 },
  'americana': { lat: -22.7385, lng: -47.3302 },
  'santa bárbara d\'oeste': { lat: -22.7550, lng: -47.4144 },
  'santa barbara d\'oeste': { lat: -22.7550, lng: -47.4144 },
  'santa barbara doeste': { lat: -22.7550, lng: -47.4144 },
  'sumaré': { lat: -22.8217, lng: -47.2668 },
  'sumare': { lat: -22.8217, lng: -47.2668 },
  'valinhos': { lat: -22.9706, lng: -46.9957 },
  'vinhedo': { lat: -23.0303, lng: -46.9755 },
  'itu': { lat: -23.2653, lng: -47.2991 },
  'atibaia': { lat: -23.1181, lng: -46.5531 },
  'bragança paulista': { lat: -22.9511, lng: -46.5436 },
  'braganca paulista': { lat: -22.9511, lng: -46.5436 },
  'jacareí': { lat: -23.3053, lng: -45.9654 },
  'jacarei': { lat: -23.3053, lng: -45.9654 },
};

/**
 * Busca coordenadas aproximadas de uma cidade pelo nome.
 * Usa mapa de cidades brasileiras, normalizando o nome (lowercase, sem acentos básicos).
 */
function buscarCoordsCidade(nomeCidade) {
  if (!nomeCidade) return null;
  const chave = nomeCidade
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/['']/g, '');
  return CIDADE_COORDS[chave] || null;
}

export async function buscarCEP(cep) {
  const cepLimpo = cep.replace(/\D/g, '');

  if (cepLimpo.length !== 8) {
    throw new Error('CEP inválido. Use 8 dígitos.');
  }

  // ─── Tentativa 1: BrasilAPI ───
  // Pode retornar coordenadas, mas nem sempre
  let dadosBrasilAPI = null;
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cepLimpo}`);
    if (response.ok) {
      const data = await response.json();
      const lat = data.location?.coordinates?.latitude || null;
      const lng = data.location?.coordinates?.longitude || null;

      dadosBrasilAPI = {
        cep: data.cep,
        logradouro: data.street,
        bairro: data.neighborhood,
        cidade: data.city,
        estado: data.state,
        latitude: lat,
        longitude: lng,
        origem: 'brasilapi',
      };

      // Se tem coordenadas, retorna direto (melhor cenário)
      if (lat && lng) return dadosBrasilAPI;
    }
  } catch {
    console.warn('[CEP] BrasilAPI falhou.');
  }

  // ─── Fallback 1: Coordenadas por cidade (usando dados da BrasilAPI se disponível) ───
  if (dadosBrasilAPI?.cidade) {
    const coords = buscarCoordsCidade(dadosBrasilAPI.cidade);
    if (coords) {
      console.log(`[CEP] Coordenadas aproximadas para ${dadosBrasilAPI.cidade}/${dadosBrasilAPI.estado}: ${coords.lat}, ${coords.lng}`);
      return { ...dadosBrasilAPI, latitude: coords.lat, longitude: coords.lng };
    }
  }

  // ─── Tentativa 2: ViaCEP (fallback, NÃO retorna coordenadas) ───
  // Só tenta se BrasilAPI não retornou nada (se retornou sem coordenadas,
  // já tentamos o fallback por cidade acima)
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    if (response.ok) {
      const data = await response.json();
      if (data.erro) throw new Error('CEP não encontrado.');

      // Tentar obter coordenadas aproximadas pelo nome da cidade
      const coords = buscarCoordsCidade(data.localidade);
      if (coords) {
        console.log(`[CEP] ViaCEP + coordenadas aproximadas para ${data.localidade}/${data.uf}: ${coords.lat}, ${coords.lng}`);
      }

      return {
        cep: data.cep,
        logradouro: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        estado: data.uf,
        latitude: coords?.lat || null,
        longitude: coords?.lng || null,
        origem: 'viacep',
      };
    }
  } catch {
    console.warn('[CEP] ViaCEP falhou.');
  }

  // ─── Último recurso: retornar dados da BrasilAPI mesmo sem coordenadas ───
  // (melhor que erro, o frontend pode calcular frete com raio padrão)
  if (dadosBrasilAPI) {
    console.warn('[CEP] Retornando dados BrasilAPI sem coordenados como fallback final');
    return dadosBrasilAPI;
  }

  throw new Error('Não foi possível consultar o CEP. Verifique o número e tente novamente.');
}
