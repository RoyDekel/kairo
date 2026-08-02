import sys
import json
import site

# Ensure user site-packages are accessible
if hasattr(site, 'USER_SITE') and site.USER_SITE not in sys.path:
    sys.path.insert(0, site.USER_SITE)

def parse_args():
    if len(sys.argv) > 1:
        try:
            return json.loads(sys.argv[1])
        except Exception:
            pass
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}

def main():
    args = parse_args()
    origin = args.get('origin', 'TLV')
    destination = args.get('destination', 'BCN')
    departure_date = args.get('departureDate', '2026-09-15')
    return_date = args.get('returnDate')
    currency = args.get('currency', 'USD')

    try:
        from fli.models import FlightSearchFilters, FlightSegment, SeatType, Airport, PassengerInfo, TripType
        from fli.search.flights import SearchFlights

        dep_airport_enum = getattr(Airport, origin.upper(), None)
        arr_airport_enum = getattr(Airport, destination.upper(), None)

        if not dep_airport_enum or not arr_airport_enum:
            print(json.dumps({'error': f'Unsupported airport code: {origin} or {destination}', 'flights': []}))
            return

        segments = [
            FlightSegment(
                departure_airport=[[dep_airport_enum, 0]],
                arrival_airport=[[arr_airport_enum, 0]],
                travel_date=departure_date
            )
        ]

        if return_date:
            segments.append(
                FlightSegment(
                    departure_airport=[[arr_airport_enum, 0]],
                    arrival_airport=[[dep_airport_enum, 0]],
                    travel_date=return_date
                )
            )

        trip_type = TripType.ROUND_TRIP if return_date else TripType.ONE_WAY
        filters = FlightSearchFilters(
            flight_segments=segments,
            passenger_info=PassengerInfo(adults=1),
            trip_type=trip_type,
            seat_type=SeatType.ECONOMY
        )

        sf = SearchFlights()
        raw_results = sf.search(filters, currency=currency)

        flights = []
        if raw_results:
            for item in raw_results:
                # Handle single leg vs multi leg tuple
                legs = item if isinstance(item, (tuple, list)) else [item]
                total_price = 0
                outbound_leg = None
                return_leg = None

                for i, leg in enumerate(legs):
                    price_val = getattr(leg, 'price', 0) or 0
                    total_price += float(price_val)
                    leg_dict = {
                        'airline': getattr(leg, 'airline', 'Google Flights'),
                        'flightNumber': getattr(leg, 'flight_number', 'GF-100'),
                        'departureTime': getattr(leg, 'departure_time', ''),
                        'arrivalTime': getattr(leg, 'arrival_time', ''),
                        'durationMinutes': getattr(leg, 'duration_minutes', 0),
                        'stops': getattr(leg, 'stops', 0)
                    }
                    if i == 0:
                        outbound_leg = leg_dict
                    elif i == 1:
                        return_leg = leg_dict

                flights.append({
                    'price': total_price,
                    'outbound': outbound_leg,
                    'return': return_leg
                })

        print(json.dumps({'flights': flights, 'error': None}))

    except Exception as e:
        print(json.dumps({'error': str(e), 'flights': []}))

if __name__ == '__main__':
    main()
