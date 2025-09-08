#!/usr/bin/env python3
"""
Improved KML Corridor Generator
Generates 300m corridors with better handling of turning points and dashed line detection.
"""

import xml.etree.ElementTree as ET
import math
from typing import List, Tuple, Dict, Optional
import argparse

def parse_coordinates(coord_string: str) -> List[Tuple[float, float, float]]:
    """Parse coordinate string into list of (lon, lat, alt) tuples."""
    coords = []
    coord_pairs = coord_string.strip().split()
    for coord_pair in coord_pairs:
        if coord_pair.strip():
            parts = coord_pair.split(',')
            if len(parts) >= 3:
                lon, lat, alt = float(parts[0]), float(parts[1]), float(parts[2])
                coords.append((lon, lat, alt))
    return coords

def calculate_distance(coord1: Tuple[float, float, float], coord2: Tuple[float, float, float]) -> float:
    """Calculate distance between two coordinates in meters using Haversine formula."""
    lon1, lat1, _ = coord1
    lon2, lat2, _ = coord2
    
    # Convert to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    
    # Haversine formula
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371000  # Earth's radius in meters
    return c * r

def calculate_bearing(coord1: Tuple[float, float, float], coord2: Tuple[float, float, float]) -> float:
    """Calculate bearing from coord1 to coord2 in degrees."""
    lon1, lat1, _ = coord1
    lon2, lat2, _ = coord2
    
    # Convert to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    
    bearing = math.atan2(y, x)
    bearing = math.degrees(bearing)
    return (bearing + 360) % 360

def project_coordinate(coord: Tuple[float, float, float], bearing_deg: float, distance_m: float) -> Tuple[float, float, float]:
    """Project a coordinate by distance and bearing to get new coordinate."""
    lon, lat, alt = coord
    
    # Earth's radius in meters
    R = 6371000
    
    # Convert to radians
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    bearing = math.radians(bearing_deg)
    
    # Calculate new latitude
    lat2 = math.asin(math.sin(lat1) * math.cos(distance_m / R) + 
                     math.cos(lat1) * math.sin(distance_m / R) * math.cos(bearing))
    
    # Calculate new longitude
    lon2 = lon1 + math.atan2(math.sin(bearing) * math.sin(distance_m / R) * math.cos(lat1),
                            math.cos(distance_m / R) - math.sin(lat1) * math.sin(lat2))
    
    return (math.degrees(lon2), math.degrees(lat2), alt)

def is_dashed_connector_line(segment: Dict) -> bool:
    """
    Determine if a segment is a dashed connector line between turning points.
    Dashed lines are typically:
    - Very short (< 500m)
    - Have 2 coordinates only
    - Not part of the main track flow
    """
    coords = segment['coordinates']
    
    # Skip segments that are not simple 2-point lines
    if len(coords) != 2:
        return False
    
    # Calculate segment length
    length = calculate_distance(coords[0], coords[1])
    
    # Very short segments are likely dashed connectors
    if length < 500:  # Less than 500m
        return True
    
    return False

def build_detailed_continuous_track(main_segments: List[Dict]) -> List[Tuple[float, float, float]]:
    """
    Build a detailed continuous track by concatenating ALL coordinates from main track segments.
    This creates a proper detailed path for accurate distance measurement.
    """
    if not main_segments:
        return []
    
    # Sort segments by index to maintain original order
    sorted_segments = sorted(main_segments, key=lambda x: x['index'])
    
    detailed_track = []
    
    print(f"\n=== BUILDING DETAILED TRACK ===")
    total_segments_used = 0
    
    for i, segment in enumerate(sorted_segments):
        coords = segment['coordinates']
        segment_length = sum(calculate_distance(coords[j], coords[j+1]) for j in range(len(coords)-1)) if len(coords) > 1 else 0
        
        print(f"Segment {segment['index']}: {len(coords)} coords, {segment_length:.1f}m")
        
        if i == 0:
            # First segment: add all coordinates
            detailed_track.extend(coords)
            total_segments_used += 1
        else:
            # For subsequent segments, always add all coordinates (skip first if it's duplicate)
            last_point = detailed_track[-1]
            first_point = coords[0]
            
            distance_to_start = calculate_distance(last_point, first_point)
            if distance_to_start < 50:  # Points are very close, likely connected
                # Skip the duplicate first coordinate
                detailed_track.extend(coords[1:])
            else:
                # Gap exists, add all coordinates including first
                detailed_track.extend(coords)
            total_segments_used += 1
    
    print(f"Built detailed track: {len(detailed_track)} total points from {total_segments_used} segments")
    
    # Calculate and show total track length for verification
    if len(detailed_track) > 1:
        total_length = sum(calculate_distance(detailed_track[i], detailed_track[i+1]) 
                          for i in range(len(detailed_track)-1))
        print(f"Total track length: {total_length:.1f}m ({total_length/1852:.2f} nautical miles)")
    
    return detailed_track

def generate_corridor_for_continuous_track(track_coords: List[Tuple[float, float, float]], 
                                         corridor_distance: float = 300.0) -> Tuple[List[Tuple[float, float, float]], 
                                                                                   List[Tuple[float, float, float]]]:
    """
    Generate left and right corridors for continuous track, ensuring exact 300m distance.
    """
    if len(track_coords) < 2:
        return [], []
    
    left_corridor = []
    right_corridor = []
    
    for i in range(len(track_coords)):
        current_coord = track_coords[i]
        
        # Calculate bearing for this point
        if i == 0:
            # First point: use bearing to next point
            next_coord = track_coords[i + 1]
            track_bearing = calculate_bearing(current_coord, next_coord)
        elif i == len(track_coords) - 1:
            # Last point: use bearing from previous point
            prev_coord = track_coords[i - 1]
            track_bearing = calculate_bearing(prev_coord, current_coord)
        else:
            # Middle points: average bearing from prev to next for smooth turns
            prev_coord = track_coords[i - 1]
            next_coord = track_coords[i + 1]
            bearing_in = calculate_bearing(prev_coord, current_coord)
            bearing_out = calculate_bearing(current_coord, next_coord)
            
            # Handle angle wrapping
            diff = bearing_out - bearing_in
            if diff > 180:
                diff -= 360
            elif diff < -180:
                diff += 360
            
            track_bearing = (bearing_in + diff/2) % 360
        
        # Calculate perpendicular bearings - EXACTLY 90 degrees left and right
        left_bearing = (track_bearing - 90) % 360
        right_bearing = (track_bearing + 90) % 360
        
        # Project corridor points at EXACTLY the specified distance
        left_point = project_coordinate(current_coord, left_bearing, corridor_distance)
        right_point = project_coordinate(current_coord, right_bearing, corridor_distance)
        
        left_corridor.append(left_point)
        right_corridor.append(right_point)
    
    return left_corridor, right_corridor

def format_coordinates(coords: List[Tuple[float, float, float]]) -> str:
    """Format coordinates for KML output."""
    return ' '.join([f"{lon},{lat},{alt}" for lon, lat, alt in coords])

def find_point_on_track(track_coords: List[Tuple[float, float, float]], target_point: Tuple[float, float, float]) -> Optional[int]:
    """Find the closest point on the track to the target point. Returns index."""
    if not track_coords:
        return None
    
    min_distance = float('inf')
    closest_index = 0
    
    for i, coord in enumerate(track_coords):
        distance = calculate_distance(coord, target_point)
        if distance < min_distance:
            min_distance = distance
            closest_index = i
    
    print(f"  Closest track point: index {closest_index}, distance {min_distance:.1f}m from target")
    return closest_index

def measure_distance_along_track(track_coords: List[Tuple[float, float, float]], start_index: int, target_distance: float) -> Optional[int]:
    """Measure distance along track from start_index and return the index at target_distance."""
    if start_index >= len(track_coords):
        return None
    
    cumulative_distance = 0.0
    print(f"    Measuring {target_distance:.1f}m from track index {start_index}")
    
    for i in range(start_index, len(track_coords) - 1):
        segment_distance = calculate_distance(track_coords[i], track_coords[i + 1])
        cumulative_distance += segment_distance
        
        if cumulative_distance >= target_distance:
            print(f"    Target distance {target_distance:.1f}m reached at index {i + 1} (cumulative: {cumulative_distance:.1f}m)")
            return i + 1
    
    print(f"    Target distance {target_distance:.1f}m NOT reached. Total track length from start: {cumulative_distance:.1f}m")
    return len(track_coords) - 1

def create_perpendicular_marker(track_coords: List[Tuple[float, float, float]], 
                               left_corridor: List[Tuple[float, float, float]], 
                               right_corridor: List[Tuple[float, float, float]], 
                               track_index: int) -> List[Tuple[float, float, float]]:
    """Create a perpendicular line from left corridor to right corridor at the given track index."""
    if track_index >= len(left_corridor) or track_index >= len(right_corridor):
        return []
    
    left_point = left_corridor[track_index]
    right_point = right_corridor[track_index]
    
    # Return line from left to right corridor
    return [left_point, right_point]

def point_at_distance_along_track(track_coords: List[Tuple[float, float, float]],
                                  start_index: int,
                                  target_distance_m: float) -> Optional[Tuple[Tuple[float, float, float], float]]:
    """
    Return the exact coordinate and local bearing at target_distance_m along the track
    starting from start_index, by projecting along the current segment when the distance
    falls within it.
    """
    if start_index >= len(track_coords) - 1:
        return None
    remaining = target_distance_m
    for i in range(start_index, len(track_coords) - 1):
        seg_start = track_coords[i]
        seg_end = track_coords[i + 1]
        seg_len = calculate_distance(seg_start, seg_end)
        if remaining <= seg_len:
            bearing = calculate_bearing(seg_start, seg_end)
            # Project from seg_start along bearing by 'remaining'
            point = project_coordinate(seg_start, bearing, remaining)
            return point, bearing
        remaining -= seg_len
    # If we run out of track, return the last point with last segment bearing
    last_bearing = calculate_bearing(track_coords[-2], track_coords[-1]) if len(track_coords) >= 2 else 0.0
    return track_coords[-1], last_bearing

def create_perpendicular_marker_at_point(point_on_track: Tuple[float, float, float],
                                         local_bearing_deg: float,
                                         corridor_distance: float) -> List[Tuple[float, float, float]]:
    """
    Create a perpendicular line across the corridor at an exact point on the track using local bearing.
    """
    left_bearing = (local_bearing_deg - 90) % 360
    right_bearing = (local_bearing_deg + 90) % 360
    left_point = project_coordinate(point_on_track, left_bearing, corridor_distance)
    right_point = project_coordinate(point_on_track, right_bearing, corridor_distance)
    return [left_point, right_point]

def generate_corridors_kml(input_filename: str, output_filename: str, corridor_distance: float = 300.0):
    """Generate corridors KML from input track KML with improved handling."""
    
    # Parse input KML
    tree = ET.parse(input_filename)
    root = tree.getroot()
    
    # KML namespace
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}
    
    # Create new KML structure
    kml_root = ET.Element("kml")
    kml_root.set("xmlns", "http://www.opengis.net/kml/2.2")
    kml_root.set("xmlns:gx", "http://www.google.com/kml/ext/2.2") 
    kml_root.set("xmlns:kml", "http://www.opengis.net/kml/2.2")
    kml_root.set("xmlns:atom", "http://www.w3.org/2005/Atom")
    
    document = ET.SubElement(kml_root, "Document")
    
    # Add styles for corridors - BOTH GREEN as requested
    left_style = ET.SubElement(document, "Style")
    left_style.set("id", "leftCorridorStyle")
    left_line_style = ET.SubElement(left_style, "LineStyle")
    ET.SubElement(left_line_style, "color").text = "ff00ff00"  # Green
    ET.SubElement(left_line_style, "width").text = "2.0"
    
    right_style = ET.SubElement(document, "Style") 
    right_style.set("id", "rightCorridorStyle")
    right_line_style = ET.SubElement(right_style, "LineStyle")
    ET.SubElement(right_line_style, "color").text = "ff00ff00"  # Green (same as left)
    ET.SubElement(right_line_style, "width").text = "2.0"
    
    # Add distance marker style - RED color
    marker_style = ET.SubElement(document, "Style")
    marker_style.set("id", "distanceMarkerStyle")
    marker_line_style = ET.SubElement(marker_style, "LineStyle")
    ET.SubElement(marker_line_style, "color").text = "ff0000ff"  # RED (AABBGGRR format)
    ET.SubElement(marker_line_style, "width").text = "4.0"
    
    # Copy original track style
    original_style = ET.SubElement(document, "Style")
    original_style.set("id", "originalTrackStyle")
    original_line_style = ET.SubElement(original_style, "LineStyle")
    ET.SubElement(original_line_style, "color").text = "ff00ffff"  # Yellow (same as original)
    ET.SubElement(original_line_style, "width").text = "2.0"
    
    # Copy ALL original styles from input KML (preserves original colors)
    original_styles = root.findall('.//kml:Style', ns) + root.findall('.//kml:StyleMap', ns)
    for style in original_styles:
        document.append(style)
    
    # Find all placemarks in original KML
    placemarks = root.findall('.//kml:Placemark', ns)
    
    # Copy ALL original placemarks first (preserves original styling)
    for placemark in placemarks:
        document.append(placemark)
    
    # Extract line segments for corridor generation
    all_segments = []
    for i, placemark in enumerate(placemarks):
        name_elem = placemark.find('kml:name', ns)
        name = name_elem.text if name_elem is not None else f"Unnamed_{i}"
        
        # Check for LineString
        linestring = placemark.find('.//kml:LineString/kml:coordinates', ns)
        if linestring is not None:
            coords = parse_coordinates(linestring.text)
            
            # Skip turning point markers (3-coordinate segments)
            if len(coords) == 3:
                continue
            
            all_segments.append({
                'index': i,
                'name': name,
                'coordinates': coords,
                'coord_count': len(coords)
            })
    
    # Classify segments
    main_track_segments = [seg for seg in all_segments if not is_dashed_connector_line(seg)]
    dashed_connectors = [seg for seg in all_segments if is_dashed_connector_line(seg)]
    
    print(f"\n=== PROCESSING SUMMARY ===")
    print(f"Total line segments found: {len(all_segments)}")
    print(f"Main track segments: {len(main_track_segments)}")
    print(f"Dashed connectors (excluded): {len(dashed_connectors)}")
    
    for connector in dashed_connectors:
        length = calculate_distance(connector['coordinates'][0], connector['coordinates'][-1])
        print(f"  Dashed connector {connector['index']}: {length:.1f}m")
    
    distance_markers_created = 0
    
    # Build detailed continuous track from main segments (ignoring dashed connectors)
    continuous_track = build_detailed_continuous_track(main_track_segments)
    
    if continuous_track:
        print(f"Built continuous track with {len(continuous_track)} points")
        
        # Generate corridors for the entire continuous track
        left_corridor, right_corridor = generate_corridor_for_continuous_track(continuous_track, corridor_distance)
        
        if left_corridor:
            # Add left corridor as single continuous line
            left_placemark = ET.SubElement(document, "Placemark")
            ET.SubElement(left_placemark, "name").text = f"Left Corridor ({corridor_distance}m)"
            ET.SubElement(left_placemark, "styleUrl").text = "#leftCorridorStyle"
            left_linestring = ET.SubElement(left_placemark, "LineString")
            ET.SubElement(left_linestring, "coordinates").text = format_coordinates(left_corridor)
            
        if right_corridor:
            # Add right corridor as single continuous line
            right_placemark = ET.SubElement(document, "Placemark")
            ET.SubElement(right_placemark, "name").text = f"Right Corridor ({corridor_distance}m)"
            ET.SubElement(right_placemark, "styleUrl").text = "#rightCorridorStyle"
            right_linestring = ET.SubElement(right_placemark, "LineString")
            ET.SubElement(right_linestring, "coordinates").text = format_coordinates(right_corridor)
        
        # Generate distance markers
        print("\n=== GENERATING DISTANCE MARKERS ===")
        
        # Find SP and TP markers from point placemarks
        sp_coord = None
        tp_coords = []
        
        for placemark in placemarks:
            name_elem = placemark.find('kml:name', ns)
            name = name_elem.text if name_elem is not None else ""
            
            point = placemark.find('.//kml:Point/kml:coordinates', ns)
            if point is not None:
                coords = parse_coordinates(point.text)
                if coords:
                    coord = coords[0]
                    if name == "SP":
                        sp_coord = coord
                        print(f"Found SP at: {coord}")
                    elif name.startswith("TP "):
                        tp_coords.append((name, coord))
                        print(f"Found {name} at: {coord}")
        
        # Sort TP coordinates by TP number
        tp_coords.sort(key=lambda x: int(x[0].split()[-1]) if x[0].split()[-1].isdigit() else 0)
        
        nautical_mile = 1852.0  # meters
        
        if sp_coord:
            # Find SP position on track
            sp_track_index = find_point_on_track(continuous_track, sp_coord)
            if sp_track_index is not None:
                print(f"SP found at track index {sp_track_index}")
                # 5 nautical miles after SP: compute exact point and local bearing
                result = point_at_distance_along_track(continuous_track, sp_track_index, 5 * nautical_mile)
                if result is not None:
                    exact_point, local_bearing = result
                    marker_line = create_perpendicular_marker_at_point(exact_point, local_bearing, corridor_distance)
                    marker_placemark = ET.SubElement(document, "Placemark")
                    ET.SubElement(marker_placemark, "name").text = "5NM after SP"
                    ET.SubElement(marker_placemark, "styleUrl").text = "#distanceMarkerStyle"
                    marker_linestring = ET.SubElement(marker_placemark, "LineString")
                    ET.SubElement(marker_linestring, "coordinates").text = format_coordinates(marker_line)
                    distance_markers_created += 1
                    print(f"Created 5NM marker after SP (exact point)")
        
        # Create markers 1NM after each TP
        for tp_name, tp_coord in tp_coords:
            tp_track_index = find_point_on_track(continuous_track, tp_coord)
            if tp_track_index is not None:
                print(f"{tp_name} found at track index {tp_track_index}")
                # 1 nautical mile after this TP: compute exact point and local bearing
                result = point_at_distance_along_track(continuous_track, tp_track_index, nautical_mile)
                if result is not None:
                    exact_point, local_bearing = result
                    marker_line = create_perpendicular_marker_at_point(exact_point, local_bearing, corridor_distance)
                    marker_placemark = ET.SubElement(document, "Placemark")
                    ET.SubElement(marker_placemark, "name").text = f"1NM after {tp_name}"
                    ET.SubElement(marker_placemark, "styleUrl").text = "#distanceMarkerStyle"
                    marker_linestring = ET.SubElement(marker_placemark, "LineString")
                    ET.SubElement(marker_linestring, "coordinates").text = format_coordinates(marker_line)
                    distance_markers_created += 1
                    print(f"Created 1NM marker after {tp_name} (exact point)")
        
        print(f"Total distance markers created: {distance_markers_created}")
    
    # Write output KML
    tree_out = ET.ElementTree(kml_root)
    tree_out.write(output_filename, xml_declaration=True, encoding='UTF-8')
    
    print(f"\n=== GENERATED CORRIDORS KML ===")
    print(f"Input file: {input_filename}")
    print(f"Output file: {output_filename}")
    print(f"Main track segments processed: {len(main_track_segments)}")
    print(f"Continuous track points: {len(continuous_track)}")
    print(f"Generated: 2 continuous corridor lines (left and right)")
    print(f"Distance markers: {distance_markers_created} perpendicular lines")
    print(f"Dashed connectors (no corridors): {len(dashed_connectors)}")
    print(f"Corridor distance: EXACTLY {corridor_distance}m")
    print(f"Corridor colors: Both corridors are GREEN")
    print(f"Distance marker colors: RED")
    print(f"Original styling: PRESERVED (no color changes)")

def main():
    parser = argparse.ArgumentParser(description='Generate corridor KML from track KML')
    parser.add_argument('-i', '--input', default='inputs/input.kml', help='Input KML path (default: inputs/input.kml)')
    parser.add_argument('-o', '--output', help='Output KML path (default: outputs/corridors.kml)')
    parser.add_argument('-d', '--distance', type=float, default=300.0, 
                       help='Corridor distance in meters (default: 300)')
    
    args = parser.parse_args()
    
    input_path = args.input
    output_path = args.output or 'outputs/corridors.kml'
    
    generate_corridors_kml(input_path, output_path, args.distance)

if __name__ == "__main__":
    main()
