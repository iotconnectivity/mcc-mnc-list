'use strict';

const fs = require('fs');
const path = require('path');
const jsdom = require('jsdom');
const plmnutils = require('./plmnutils.js');
const centroids = require('./centroids.json'); // Converted from http://gothos.info/resources/ country centroids csv file
const { JSDOM } = jsdom;

const WIKI_URLS = [
  'https://en.wikipedia.org/wiki/Mobile_country_code',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_2xx_(Europe)',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_3xx_(North_America)',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_4xx_(Asia)',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_5xx_(Oceania)',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_6xx_(Africa)',
  'https://en.wikipedia.org/wiki/Mobile_Network_Codes_in_ITU_region_7xx_(South_America)'
];

const MCC_MNC_OUTPUT_FILE = path.join( __dirname, 'mcc-mnc-list.json');
const STATUS_CODES_OUTPUT_FILE = path.join( __dirname, 'status-codes.json');

fs.writeFileSync(MCC_MNC_OUTPUT_FILE, "");

var statusCodes = [];
var records = [];

async function fetch (wiki_url) {
  return new Promise((resolve, reject) => {
    JSDOM.fromURL(wiki_url).then(dom =>
      {
        const { window } = dom;
        var content = window.document.querySelector('#mw-content-text > .mw-parser-output');

        if (!content.hasChildNodes()) {
          console.log('ERROR - empty content');
          return;
        }

        content = removeCiteReferences(content);

        const children = content.childNodes;
        let recordType, sectionName, countryName = null, countryCode = null;

        nodeList: for (let i = 0; i < children.length; i++) {
          let node = children[i];

          if (!node.textContent.trim().length) {
            // skip empty lines
            continue;
          }

          if (node.nodeName === 'H2' || node.nodeName === 'H3' || node.nodeName === 'H4') {
            recordType = 'other';
            sectionName = node.querySelector('.mw-headline').textContent.trim();

            if (sectionName === 'See also' || sectionName === 'External links' || sectionName === 'National MNC Authorities') {
              break nodeList;
            }

            if (sectionName === 'National operators') {
              continue;
            }

            if (sectionName.length === 1) {
              continue;
            }

            if (sectionName === 'Test networks') {
              countryName = null;
              countryCode = null;
              recordType = 'Test';
            }

            if (sectionName.indexOf(' – ') !== -1) {
              let sectionParts = sectionName.split(' – ');
              countryName = sectionParts[0];
              countryCode = sectionParts[1];
              recordType = 'National';
            }

            if (sectionName === 'International operators') {
              countryName = null;
              countryCode = null;
              recordType = 'International';
            }

            if (recordType === 'other') {
              console.log('WARN recordType is other', node.textContent);
            }
          }

          if (node.nodeName === 'TABLE') {
            let rows = node.querySelectorAll('tr');

            for (let j = 1; j < rows.length; j++) {
              let cols = rows[j].querySelectorAll('td');

              if (cols.length < 7) {
                console.log('WARN invalid table row:', rows[j], node.textContent);
                continue;
              }

              let status = cleanup(cols[4].textContent);
              if (status === 'Not Operational') {
                status = 'Not operational';
              }
              if (status === 'operational') {
                status = 'Operational';
              }

              if ( status && statusCodes.indexOf( status ) === -1 ) {
                statusCodes.push( status );
              }

              var mcc = cleanup(cols[0].textContent);
              var mnc = cleanup(cols[1].textContent);
              var plmn = mcc ? (mnc ? mcc + mnc : null) : null;
              var nibbledPlmn = plmn ? plmnutils.encPlmn(mcc, mnc) : null;
              var region = plmnutils.getRegion(mcc);

              // Get last 2 char of countryCode to ensure matching with a ISO 3166-1 alpha-2 code
              var geo = countryCode ? getGeo(countryCode.toUpperCase().slice(-2)) : getGeo(null);

              records.push({
                plmn: plmn,
                nibbledPlmn: nibbledPlmn,
                mcc: mcc,
                mnc: mnc,
                region: region,
                type: recordType,
                countryName: countryName,
                countryCode: countryCode,
                lat: geo.lat,
                long: geo.long,
                brand: cleanup(cols[2].textContent),
                operator: cleanup(cols[3].textContent),
                status: status,
                bands: cleanup(cols[5].textContent),
                notes: cleanup(cols[6].textContent)
              })
            }
          }
        }
        console.log( 'MCC-MNC list saved to ' + MCC_MNC_OUTPUT_FILE );
        console.log( 'Total ' + records.length + ' records' );
        resolve()
    })
  })

}

function removeCiteReferences(nodes) {
  let links = nodes.querySelectorAll('a');
  for (let i = 0; i < links.length; i++) {
    let link = links[i];
    let href = link.getAttribute('href');
    if (href.substr(0, 10) === '#cite_note') {
      link.remove();
    }
  }

  return nodes;
}

function cleanup(str) {
  str = str.trim();
  str = removeCitationNeeded(str);
  if (str.substr(0, 1) === '[' && str.substr(-1) === ']') {
    // remove brackets-only like [7]
    str = '';
  }
  if (str.substr(0, 1) != '[' && str.substr(-1) === ']') {
    // remove postfix references like ...[7]
    let index = str.lastIndexOf('[');
    str = str.substr(0, index - 1).trim();
  }
  return str.length ? str : null;
}

function removeCitationNeeded(str) {
  return str.replace(/\[citation needed\]/g, '');
}

function getGeo(countryCode) {
  var centroid = centroids.filter(function(el) {return el.ISO3136.toUpperCase() == countryCode});

  if (centroid.length) {
    return { 'lat': String(centroid[0].LAT), 'long': String(centroid[0].LONG) };
  } else {
    return { 'lat': null, 'long': null };
  }
}

async function run() {
  for (const wiki_url of WIKI_URLS) {
    await fetch(wiki_url);
  }

  fs.appendFile( MCC_MNC_OUTPUT_FILE, JSON.stringify( records, null, 2 ), err => {
    if ( err ) {
      throw err;
    }
  });

  statusCodes.sort();
  console.log("fin");

  fs.writeFile( STATUS_CODES_OUTPUT_FILE, JSON.stringify( statusCodes, null, 2 ), err => {
    if ( err ) {
      throw err;
    }
    console.log( 'Status codes saved to ' + STATUS_CODES_OUTPUT_FILE );
  });
}

run()
