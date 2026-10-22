# Demo Security Cameras

Open Security Cameras in the action bar, or select a labeled camera on the map.
The app adds 8 cameras in the Main Store (6 on Level 1, 2 on Level 2) and 5 around
the entrance, curbside area, lumber drive-thru and warehouse yard. These are
client-side demo layers; no hosted features or web map items are edited.

Camera positions, headings, range and field of view are defined in
`CAMERA_LAYOUT` in `cameras.js`. Positions are fractions of each facility's
bounding extent, queried in EPSG:26993. Indoor positions are checked against the
footprint, and indoor coverage wedges are clipped to that footprint. Department
names are illustrative labels, not surveyed department or installation positions.
The wedges are not obstruction-aware viewshed analysis: walls, shelving, height,
terrain and intervening buildings are not evaluated.

The viewer loops representative stock footage with a camera ID and a current
America/Chicago timestamp. It is labeled SIMULATED LIVE throughout. It is not an
actual store feed or a reconstruction of the camera's mapped location. Indoor
cameras currently share a warehouse-aisle clip, not retail sales-floor footage;
exterior cameras share a lumber-yard aerial clip. Internet access is required.
Browser autoplay restrictions can require pressing the video's play control.

Replace `CAMERA_MEDIA` in `cameras.js` with approved MP4 URLs and poster images for
store-specific scenes. The current media is supplied under the Pexels license:

- Indoor: Tiger Lily, https://www.pexels.com/video/a-footage-inside-the-warehouse-4294436/
- Yard: K, https://www.pexels.com/video/aerial-drone-view-of-lumber-storage-yard-31025267/
- License: https://www.pexels.com/license/

The existing hosted security devices, alarms and Arcade popups are unchanged.
The new cameras have their own click viewer and appear in Layers and Legend.