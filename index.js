var noble = require('noble');

var Accessory, Service, Characteristic, UUIDGen;

const BLIND_SERVICE_UUID = 'fe50';
const BLIND_SET_CHAR_UUID = 'fe51';
const BLIND_VAL_MIN = 100;
const BLIND_VAL_MAX = 164;
const BLIND_SET_VALUE_BASE = 0x00ff00009a;
const BLIND_SET_VALUE_BASE2 = 0x0d;
const Conversion3_1 =
{
    '0': '6', '1': '7', '2': '4', '3': '5',
    '4': '2', '5': '3', '6': '0', '7': '1',
    '8': 'e', '9': 'f', 'a': 'c', 'b': 'd',
    'c': 'a', 'd': 'b', 'e': '8', 'f': '9'
};
const Conversion4_2 =
{
    '0': '9', '1': '8', '2': 'b', '3': 'a',
    '4': 'd', '5': 'c', '6': 'f', '7': 'e',
    '8': '1', '9': '0', 'a': '3', 'b': '2',
    'c': '5', 'd': '4', 'e': '7', 'f': '6'
};

// Power on for scanning
noble.on('stateChange', function (state) {
    if (state === 'poweredOn') {
        noble.startScanning([BLIND_SERVICE_UUID]);
    } else {
        console.log("[Noble] bt poweredOn problem!");
        noble.stopScanning();
    }
});

module.exports = function (homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-blind-platform", "BlindPlatform", BlindPlatform, true);
}


function BlindPlatform(log, config, api) {
    log("Blind Platform Init");
    var platform = this;
    this.log = log;
    this.config = config;
    this.accessories = [];

    noble.on('discover', function (peripheral) {
        peripheral.connect(function (error) {
            platform.addAccessory(peripheral);
        });
    });

    if (api) {
        this.api = api;

        this.api.on('didFinishLaunching', function () {
            platform.log("DidFinishLaunching");
        }.bind(this));
    }
}

function messageConverter(value) {
    var scaled_val = (100 - value) / 100 * (BLIND_VAL_MAX - BLIND_VAL_MIN) + BLIND_VAL_MIN;
    scaled_val = Math.floor(scaled_val);
    var n_str = '0' + scaled_val.toString();
    n_str = n_str + Conversion4_2[n_str[2]] + Conversion3_1[n_str[3]]
    str_arr = n_str.match(/.{1,2}/g);
    var ret_array = [BLIND_SET_VALUE_BASE, BLIND_SET_VALUE_BASE2];
    for (var i = 0; i < str_arr.length; i++)
        ret_array.push(parseInt('0x' + str_arr[i]));
    return ret_array;
}

BlindPlatform.prototype.getCurrentPosition = function (callback) {
    this.log("Requested CurrentPosition: %s", this.lastPosition);
    callback(null, this.lastPosition);
}

BlindPlatform.prototype.getPositionState = function (callback) {
    this.log("Requested PositionState: %s", this.currentPositionState);
    callback(null, this.currentPositionState);
}

BlindPlatform.prototype.getTargetPosition = function (callback) {
    this.log("Requested TargetPosition: %s", this.currentTargetPosition);
    callback(null, this.currentTargetPosition);
}

BlindPlatform.prototype.setTargetPosition = function (pos, callback) {
    this.currentTargetPosition = pos;
    if (this.currentTargetPosition > this.lastPosition)
        this.currentPositionState = 1;
    else
        this.currentPositionState = 0;

    this.service.getCharacteristic(Characteristic.TargetPosition).updateValue(pos);
    this.service.getCharacteristic(Characteristic.PositionState).updateValue(this.currentPositionState);

    var platform = this;
    this.levelCharacteristic.write(
        new Buffer(messageConverter(pos)),
        true,
        function (error) {
            platform.log("Set TargetPosition: %s", pos);
            setTimeout((platform, pos) => {
                if (pos == platform.currentTargetPosition) {
                    platform.lastPosition = pos;
                    platform.currentPositionState = 2;

                    platform.service.getCharacteristic(Characteristic.CurrentPosition).updateValue(pos);
                    platform.service.getCharacteristic(Characteristic.PositionState).updateValue(platform.currentPositionState);
                    platform.log("Position set to: %s", pos);
                }
            },
                Math.abs(platform.currentTargetPosition - platform.lastPosition) * 240 + 75,
                platform, pos);
        }
    );
    callback(null);
}

BlindPlatform.prototype.configureAccessory = function (accessory) {
    this.log(accessory.displayName, "Configure Accessory");
    var platform = this;

    accessory.reachable = true;

    accessory.on('identify', function (paired, callback) {
        platform.log(accessory.displayName, "Identify!!!");
        callback();
    });

    this.accessories.push(accessory);
}

// Sample function to show how developer can add accessory dynamically from outside event
BlindPlatform.prototype.addAccessory = function (peripheral) {
    var platform = this;
    platform.log("Connected to %s", peripheral.advertisement.localName);

    uuid = UUIDGen.generate(peripheral.uuid);

    var newAccessory = new Accessory(peripheral.advertisement.localName, uuid);

    newAccessory.log = this.log;
    newAccessory.lastPosition = 100; // last known position of the blinds, open by default
    newAccessory.currentPositionState = 2; // stopped by default
    newAccessory.currentTargetPosition = 100; // closed by default

    peripheral.discoverServices([BLIND_SERVICE_UUID], function (error, services) {
        var deviceInformationService = services[0];
        platform.log('discovered device information service');

        deviceInformationService.discoverCharacteristics([BLIND_SET_CHAR_UUID], function (error, characteristics) {
            var levelCharacteristic = characteristics[0];
            newAccessory.levelCharacteristic = levelCharacteristic;
            platform.log('discovered set-value characteristics');

            levelCharacteristic.write(new Buffer(messageConverter(100)), true, function (error) {
                platform.log('set initial blind level to open');
            });

            newAccessory.on('identify', function (paired, callback) {
                platform.log(newAccessory.displayName, "Identify!!!");
                callback();
            });

            var service = newAccessory.addService(Service.WindowCovering, "Position");
            newAccessory.service = service;

            //service.setCharacteristic(Characteristic.Name, peripheral.advertisement.localName);

            service.getCharacteristic(Characteristic.CurrentPosition)
                .on('get', platform.getCurrentPosition.bind(newAccessory));


            // the position state (0 = DECREASING, 1 = INCREASING, 2 = STOPPED)
            service.getCharacteristic(Characteristic.PositionState)
                .on('get', platform.getPositionState.bind(newAccessory));

            // the target position (0-100%)
            service.getCharacteristic(Characteristic.TargetPosition)
                .on('get', platform.getTargetPosition.bind(newAccessory))
                .on('set', platform.setTargetPosition.bind(newAccessory));

            service.getCharacteristic(Characteristic.TargetPosition).updateValue(newAccessory.currentTargetPosition);
            service.getCharacteristic(Characteristic.PositionState).updateValue(newAccessory.currentPositionState);
            service.getCharacteristic(Characteristic.CurrentPosition).updateValue(newAccessory.lastPosition);

            service.getCharacteristic(Characteristic.Name).updateValue(peripheral.advertisement.localName);

            platform.log("Accesory setup is done!..");
        });
    });

    this.accessories.push(newAccessory);
    this.api.registerPlatformAccessories("homebridge-blind-platform", "BlindPlatform", [newAccessory]);
}
