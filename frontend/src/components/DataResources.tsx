import Icon from './Icon'

const groups = [
  {
    title: 'More datasets',
    intro: 'Explore other records and regions in the challenge’s data portals.',
    items: [
      { title: 'Giovanni', organization: 'NASA', url: 'https://giovanni.earthdata.nasa.gov/', description: 'Select geophysical variables and generate maps or time series.' },
      { title: 'Hydrology Time Series', organization: 'NASA GES DISC', url: 'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series', description: 'Explore time-series tools for hydrological data.' },
      { title: 'AppEEARS', organization: 'NASA / USGS', url: 'https://appeears.earthdatacloud.nasa.gov/', description: 'Extract point or area samples from geospatial datasets. Earthdata sign-in is required for extraction.' },
      { title: 'Climate Data Online', organization: 'NOAA NCEI', url: 'https://www.ncei.noaa.gov/cdo-web/', description: 'Find historical weather, climate records and station information.' },
    ],
  },
  {
    title: 'Methods and examples',
    intro: 'Use these references to investigate assumptions and interpret uncertainty.',
    items: [
      { title: 'KNMI Climate Explorer', organization: 'KNMI', url: 'https://climexp.knmi.nl/', description: 'Explore climate time series, gridded fields and relationships between records.' },
      { title: 'SeaWiFS chlorophyll time-series study', organization: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/api/citations/20090042747/downloads/20090042747.pdf', description: 'A research example of time-series creation and significance testing in coastal regions. PDF.' },
      { title: 'Statistical trend tests', organization: 'Third-party introduction · Medium', url: 'https://medium.com/@snp.kriss/statistical-test-methods-to-detect-trends-in-time-series-data-b361a0ec530b', description: 'An additional introduction listed in the challenge resources.' },
      { title: 'Statistical significance guide', organization: 'Third-party introduction · Statsig', url: 'https://www.statsig.com/perspectives/a-comprehensive-guide-to-statistical-significance', description: 'Further reading on significance, alongside the assumptions of the test being used.' },
    ],
  },
  {
    title: 'Canadian data',
    intro: 'The challenge also points to water, radar and ecosystem resources.',
    items: [
      { title: 'RADARSAT Constellation Mission data', organization: 'Canadian Space Agency', url: 'https://donnees-data.asc-csa.gc.ca/en/dataset/rcm', description: 'Radar observations for maritime, disaster and ecosystem monitoring.' },
      { title: 'GEO.ca', organization: 'Government of Canada', url: 'https://geo.ca/', description: 'Explore Canada’s open geospatial information.' },
      { title: 'SWOT mission', organization: 'Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/satellites/swot/', description: 'Learn about observations of surface-water elevation and its change over time.' },
      { title: 'Monitoring ecosystems from space', organization: 'Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/satellites/everyday-lives/monitoring-and-protecting-our-ecosystems-from-space.asp', description: 'Examples of using satellite observations to understand environmental change.' },
      { title: 'Synthetic Aperture Radar tutorial', organization: 'Canadian Space Agency · GitHub', url: 'https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial', description: 'Practical guidance for working with SAR imagery in Python and QGIS.' },
    ],
  },
]

export default function DataResources() {
  return <section className="resources-section" id="data-resources" aria-labelledby="resources-heading">
    <h2 id="resources-heading" className="sr-only">Data and methods</h2>
    <div className="connected-source">
      <div><span className="dataset-label">Weather & soil data used in TerraSignal</span><h3>NASA POWER · MERRA-2</h3><p>Daily and monthly temperature and precipitation records come from a reanalysis: a model that combines observations with a representation of the atmosphere. Connections also uses monthly root-zone soil wetness (GWETROOT), a dimensionless model fraction rather than volumetric water content. Weather and soil share the same modelling system. Each selected point represents a model grid cell, rather than a weather station or an average of an entire city or country.</p>
        <p>The result panel and CSV preserve the original request, retrieval date and whether the response was live, cached or a saved snapshot. Saved observations are labelled; they are never presented as a new NASA retrieval.</p>
        <div className="source-links"><a href="https://power.larc.nasa.gov/docs/services/api/temporal/monthly/" target="_blank" rel="noreferrer">Monthly API & coverage <Icon name="external" /></a><a href="https://power.larc.nasa.gov/docs/services/api/temporal/daily/" target="_blank" rel="noreferrer">Daily API & time standards <Icon name="external" /></a><a href="https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/" target="_blank" rel="noreferrer">MERRA-2 data provenance <Icon name="external" /></a></div>
      </div>
      <div className="reading-results"><h3>Reading results</h3><dl>
        <div><dt>Rate of change</dt><dd>The fitted change per year or decade, in the variable’s units. It is an estimate for the chosen period, not a forecast.</dd></div>
        <div><dt>95% confidence interval</dt><dd>Uncertainty in the estimated rate under this model. An interval containing zero does not resolve the trend at the 5% level.</dd></div>
        <div><dt>p-value</dt><dd>Under a zero-trend hypothesis and the model assumptions, how unusual a test statistic at least this extreme would be. It is not the probability that there is no change.</dd></div>
        <div><dt>Temperature departure</dt><dd>A selected month is compared with the same month in the fixed 1991–2020 reference. The calendar workspace uses day-weighted means and requires complete current and reference months.</dd></div>
        <div><dt>Seasonality & significance</dt><dd>The all-month model controls for calendar-month differences with 12 monthly HAC lags. Calendar investigations use yearly aggregates with one annual HAC lag. Testing many months or periods can produce chance findings; choose a question before looking for a small p-value.</dd></div>
        <div><dt>Period sensitivity</dt><dd>In Daily weather and each daily comparison point, “Compare fitted periods” compares the loaded interval with available starts in 1991 and 2001. All windows share an end year. Adjusted p-values cover all four indices across these periods; different rates alone do not show that the slopes differ.</dd></div>
        <div><dt>Landscape memory</dt><dd>Memory follows dry episodes through rainfall, modelled soil wetness and satellite greenness. Its ranks compare the same calendar month in other years of the loaded record, excluding the target year. At least ten available reference years are required. Ranks describe the available observations; they are not confidence levels or probabilities of future events. Two consecutive months confirm a return under the displayed rule. Missing observations can prevent measuring its timing.</dd></div>
      </dl><a className="method-reference" href="https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLSResults.get_robustcov_results.html" target="_blank" rel="noreferrer">Statistical method reference <Icon name="external" /></a></div>
    </div>
    <div className="source-extension"><p className="overline">Vegetation & relationships</p><h3>NASA Terra MODIS · vegetation greenness</h3><p>Connections load numeric MOD13Q1 NDVI and quality masks through Planetary Computer, averaging a 9 × 9 native-pixel area. An original filtered and scaled ORNL CSV can also be imported. Cloud, snow and low-quality observations remain gaps. Monthly values summarize complete sets of 16-day composites by their start month; they are not daily calendar-month means. The small MODIS footprint differs from the surrounding weather grid.</p><p>Imported files retain their SHA-256, coordinates, collection and quality gaps, but their origin is user supplied and is not independently authenticated. Service outages are shown explicitly; weather observations never substitute for missing NDVI.</p><p>Relationships remove the calendar-month cycle and optionally linear trends. Pearson correlation is descriptive, without a significance badge or a claim of causation. Its matched-period reference is separate from Calendar's 1991–2020 baseline.</p><div className="source-links"><a href="https://modis.gsfc.nasa.gov/data/dataprod/mod13.php" target="_blank" rel="noreferrer">MODIS vegetation indices <Icon name="external" /></a><a href="https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-13Q1-061" target="_blank" rel="noreferrer">MODIS source catalog <Icon name="external" /></a><a href="https://www.psl.noaa.gov/data/atmoswrit/corr/caveats/" target="_blank" rel="noreferrer">Interpreting climate correlations <Icon name="external" /></a></div></div>
    <p className="resources-intro">Continue your investigation with the challenge resources below. These links open external tools; their other datasets are not automatically loaded into TerraSignal. Access requirements and data-use terms vary by provider.</p>
    <div className="resource-groups">{groups.map(group => <details className="resource-group" key={group.title}>
      <summary><span><strong>{group.title}</strong><small>{group.items.length} resources</small></span><Icon name="chevron" /></summary>
      <p>{group.intro}</p><ul>{group.items.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong><Icon name="external" /></a><span>{item.organization}</span><p>{item.description}</p></li>)}</ul>
    </details>)}</div>
    <p className="nasa-disclaimer">NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites. For non-U.S. Government websites, participants must comply with any data use parameters of that specific website.</p>
  </section>
}
