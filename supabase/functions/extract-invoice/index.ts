import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const TOOL = {
  type: 'function',
  function: {
    name: 'extract_invoice',
    description: '계약서/송장 사진에서 배송 건들을 추출합니다.',
    parameters: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: '추출된 배송 건 목록. 한 사진에 여러 건이 있으면 모두.',
          items: {
            type: 'object',
            properties: {
              customer: { type: 'string', description: '고객명/받는분/수령인. 불분명하면 빈 문자열.' },
              region: { type: 'string', description: '배송지 주소 (시/도, 구/군, 동까지). 불분명하면 빈 문자열.' },
              item: { type: 'string', description: '품목/상품명. 여러 개면 쉼표로 구분. 불분명하면 빈 문자열.' },
              note: { type: 'string', description: '특이사항/비고. 없으면 빈 문자열.' },
              uncertain: {
                type: 'array',
                description: '신뢰도 낮은(체크요망) 필드명들. customer|region|item|note 중에서.',
                items: { type: 'string' },
              },
            },
            required: ['customer', 'region', 'item', 'note', 'uncertain'],
            additionalProperties: false,
          },
        },
      },
      required: ['rows'],
      additionalProperties: false,
    },
  },
} as const;

const SYSTEM = `당신은 한국 배송 계약서/송장 사진을 정확히 분석하는 OCR 어시스턴트입니다.
규칙:
- 사진에 보이는 글자만 추출합니다. 추측 금지.
- 한 사진에 여러 건이 있을 수 있습니다. 모두 행으로 분리해서 반환.
- 글자가 흐리거나 가려져 자신없는 필드는 uncertain 배열에 필드명을 넣고 값은 가능한 한 추출하되 모르면 빈 문자열.
- 주소는 시/도 + 시/군/구 + 동/읍/면 까지 정규화 (예: "서울시 강남구 역삼동").
- 절대 JSON 외 텍스트를 출력하지 말고 반드시 extract_invoice 도구를 호출하세요.`;

async function extractOne(imageDataUrl: string, apiKey: string) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: '이 사진에서 배송 건들을 추출하세요.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'extract_invoice' } },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway ${res.status}: ${t}`);
  }
  const data = await res.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) return { rows: [] };
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return { rows: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) throw new Error('LOVABLE_API_KEY 미설정');
    const { images } = await req.json();
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'images 배열이 필요합니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (images.length > 20) {
      return new Response(JSON.stringify({ error: '최대 20장까지 가능합니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allRows: any[] = [];
    const errors: { index: number; message: string }[] = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const out = await extractOne(images[i], apiKey);
        const rows = Array.isArray(out?.rows) ? out.rows : [];
        for (const r of rows) {
          allRows.push({
            customer: String(r.customer ?? ''),
            region: String(r.region ?? ''),
            item: String(r.item ?? ''),
            note: String(r.note ?? ''),
            uncertain: Array.isArray(r.uncertain) ? r.uncertain.map(String) : [],
            source: i + 1,
          });
        }
      } catch (e) {
        errors.push({ index: i + 1, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ rows: allRows, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});