export type CarrierCode = 'DHL' | 'UPS' | 'FedEx';

export interface TrackingEvent {
  timestamp: string;
  location: string;
  status: string;
  description: string;
}

export interface TrackingResult {
  carrier: CarrierCode;
  trackingNumber: string;
  status: string;
  statusCode: 'in_transit' | 'delivered' | 'pending' | 'exception' | 'out_for_delivery';
  origin: string;
  destination: string;
  estimatedDelivery?: string;
  weight?: string;
  service?: string;
  events: TrackingEvent[];
  isMock?: boolean;
  error?: string;
}

// Normalize DHL response
function normalizeDHL(data: any, trackingNumber: string): TrackingResult {
  if (data.mock) return data as TrackingResult;

  const shipment = data.shipments?.[0];
  if (!shipment) throw new Error('No DHL shipment data');

  const statusMap: Record<string, TrackingResult['statusCode']> = {
    'delivered': 'delivered',
    'in-transit': 'in_transit',
    'transit': 'in_transit',
    'out-for-delivery': 'out_for_delivery',
    'failure': 'exception',
  };

  const rawStatus = (shipment.status?.status || '').toLowerCase();
  const statusCode = statusMap[rawStatus] || 'in_transit';

  const events: TrackingEvent[] = (shipment.events || []).map((e: any) => ({
    timestamp: e.timestamp || '',
    location: [e.location?.address?.addressLocality, e.location?.address?.countryCode]
      .filter(Boolean).join(', '),
    status: e.status || '',
    description: e.description || '',
  }));

  return {
    carrier: 'DHL',
    trackingNumber,
    status: shipment.status?.description || shipment.status?.status || 'Unknown',
    statusCode,
    origin: shipment.origin?.address?.addressLocality || '-',
    destination: shipment.destination?.address?.addressLocality || '-',
    estimatedDelivery: shipment.estimatedTimeOfDelivery,
    weight: shipment.shipmentTrackingNumber,
    service: shipment.service,
    events,
  };
}

// Normalize UPS response
function normalizeUPS(data: any, trackingNumber: string): TrackingResult {
  if (data.mock) return data as TrackingResult;

  const pkg = data.trackResponse?.shipment?.[0]?.package?.[0];
  if (!pkg) throw new Error('No UPS package data');

  const rawStatus = (pkg.currentStatus?.description || '').toLowerCase();
  const statusCode: TrackingResult['statusCode'] =
    rawStatus.includes('delivered') ? 'delivered' :
    rawStatus.includes('out for delivery') ? 'out_for_delivery' :
    rawStatus.includes('exception') ? 'exception' : 'in_transit';

  const events: TrackingEvent[] = (pkg.activity || []).map((a: any) => ({
    timestamp: `${a.date || ''} ${a.time || ''}`.trim(),
    location: [a.location?.address?.city, a.location?.address?.countryCode]
      .filter(Boolean).join(', '),
    status: a.status?.type || '',
    description: a.status?.description || '',
  }));

  return {
    carrier: 'UPS',
    trackingNumber,
    status: pkg.currentStatus?.description || 'Unknown',
    statusCode,
    origin: pkg.packageAddress?.find((a: any) => a.type === 'ORIGIN')?.address?.city || '-',
    destination: pkg.packageAddress?.find((a: any) => a.type === 'DESTINATION')?.address?.city || '-',
    estimatedDelivery: pkg.deliveryDate?.[0]?.date,
    service: data.trackResponse?.shipment?.[0]?.service?.description,
    events,
  };
}

// Normalize FedEx response
function normalizeFedEx(data: any, trackingNumber: string): TrackingResult {
  if (data.mock) return data as TrackingResult;

  const result = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!result) throw new Error('No FedEx tracking result');

  const rawStatus = (result.latestStatusDetail?.code || '').toLowerCase();
  const statusCode: TrackingResult['statusCode'] =
    rawStatus === 'dl' ? 'delivered' :
    rawStatus === 'od' ? 'out_for_delivery' :
    rawStatus === 'ex' ? 'exception' : 'in_transit';

  const events: TrackingEvent[] = (result.scanEvents || []).map((e: any) => ({
    timestamp: e.date || '',
    location: [e.scanLocation?.city, e.scanLocation?.countryCode]
      .filter(Boolean).join(', '),
    status: e.eventType || '',
    description: e.eventDescription || '',
  }));

  return {
    carrier: 'FedEx',
    trackingNumber,
    status: result.latestStatusDetail?.description || 'Unknown',
    statusCode,
    origin: result.originLocation?.locationContactAndAddress?.address?.city || '-',
    destination: result.destinationLocation?.locationContactAndAddress?.address?.city || '-',
    estimatedDelivery: result.estimatedDeliveryTimeWindow?.window?.ends,
    service: result.serviceDetail?.description,
    events,
  };
}

// Main tracking function
export async function trackShipment(
  trackingNumber: string,
  carrier: CarrierCode
): Promise<TrackingResult> {
  try {
    if (carrier === 'DHL') {
      const res = await fetch(`/api/tracking/dhl/${encodeURIComponent(trackingNumber)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return normalizeDHL(data, trackingNumber);
    }

    if (carrier === 'UPS') {
      const res = await fetch(`/api/tracking/ups/${encodeURIComponent(trackingNumber)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return normalizeUPS(data, trackingNumber);
    }

    if (carrier === 'FedEx') {
      const res = await fetch('/api/tracking/fedex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return normalizeFedEx(data, trackingNumber);
    }

    throw new Error('Unknown carrier');
  } catch (err: any) {
    return {
      carrier,
      trackingNumber,
      status: 'Hata',
      statusCode: 'exception',
      origin: '-',
      destination: '-',
      events: [],
      error: err.message || 'Tracking failed',
    };
  }
}
